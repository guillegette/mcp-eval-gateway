# mcp-eval-gateway

[![npm version](https://img.shields.io/npm/v/mcp-eval-gateway.svg)](https://www.npmjs.com/package/mcp-eval-gateway)
[![CI](https://github.com/guillegette/mcp-eval-gateway/actions/workflows/ci.yml/badge.svg)](https://github.com/guillegette/mcp-eval-gateway/actions/workflows/ci.yml)

Run an agent against your MCP server and score the tool calls.

Each task in `eval/tasks.yaml` is a prompt. The runner connects to the server, records which tools the model calls, and scores the outcome. The report lists every tool the server exposed and whether the suite invoked it. In GitHub Actions, that report is the job summary, and the job fails when accuracy is less than `threshold` or a required task fails.

The runner uses the [Vercel AI SDK](https://ai-sdk.dev/). The agent loop, tagged response extraction, and scoring follow Anthropic's [tool evaluation cookbook](https://github.com/anthropics/anthropic-cookbook).

## Get started

You need Node.js 22 or later.

1. Add the package as a development dependency:

```bash
npm install --save-dev mcp-eval-gateway
```

2. Create the eval files:

```bash
npx mcp-eval-gateway init
```

The command writes two files. It does not overwrite them if they already exist.

`eval/config.ts`:

```ts
export default {
  model: 'gateway/anthropic/claude-sonnet-4-6',
  threshold: 0.8,
  mcp: {
    url: 'http://localhost/mcp',
    headers: { Authorization: `Bearer ${process.env.MCP_API_KEY}` },
  },
};
```

`eval/tasks.yaml`:

```yaml
- name: ping
  prompt: Call the ping tool and return its text
  expected: pong
  required: true
```

To write the files under a different folder:

```bash
npx mcp-eval-gateway init --dir src/eval
```

These files are a starting point. To evaluate your server, point the config at it, replace the sample task, and run the evals. The following sections walk through that path: [Connect the MCP server](#connect-the-mcp-server), [Write the tasks](#write-the-tasks), and [Run the evals](#run-the-evals). To fail a pull request on the result, see [Add the eval to CI](#add-the-eval-to-ci).

## Connect the MCP server

The `mcp` field in `eval/config.ts` is how the runner opens a session with your MCP server. The runner passes that object to [`toolsFromMcp`](#toolsfrommcp), a function in this package that connects and exposes the server's tools to the model.

The generated config reads the server credential from `process.env.MCP_API_KEY`. Rename or remove that variable to match whatever your server expects in its headers.

Use one of the following shapes.

### Use a running server

Point `url` at a Streamable HTTP MCP server. This is what `init` writes.

```ts
export default {
  model: 'gateway/anthropic/claude-sonnet-4-6',
  threshold: 0.8,
  mcp: {
    url: 'https://example.com/mcp',
    headers: { Authorization: `Bearer ${process.env.MCP_API_KEY}` },
  },
};
```

### Replace fetch

Keep `url` and `headers`. Pass `fetch` to wrap the request (extra headers, a test server, or a custom client).

```ts
export default {
  model: 'gateway/anthropic/claude-sonnet-4-6',
  threshold: 0.8,
  mcp: {
    url: 'http://localhost/mcp',
    headers: { Authorization: `Bearer ${process.env.MCP_API_KEY}` },
    fetch: async (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set('X-Test-Run', '1');
      return fetch(input, { ...init, headers });
    },
  },
};
```

### Call an in-process handler

Pass a `fetch` function that calls your route handler. The handler runs in the same process, so the request does not go over the network. This is the Next.js App Router pattern.

```ts
import { POST } from '../app/mcp/route.js';

export default {
  model: 'gateway/anthropic/claude-sonnet-4-6',
  threshold: 0.8,
  mcp: {
    url: 'http://localhost/mcp',
    fetch: (input: string | URL, init?: RequestInit) =>
      POST(new Request(input, init)),
    headers: { Authorization: `Bearer ${process.env.MCP_API_KEY}` },
  },
};
```

## Write the tasks

`eval/tasks.yaml` lists the tasks the model must complete against your server's tools. Each task must include `name`, `prompt`, and exactly one of `expected` or `judge`:

- `expected`: the runner scores the final `<response>` by exact string match.
- `judge`: a plain-English expected outcome. A judge model reviews the run's tool calls and scores whether that outcome was met.

Set `required` to `true` when a failed task must fail the run.

```yaml
- name: ping
  prompt: Call the ping tool and return its text
  expected: pong
  required: true
- name: search-empty
  prompt: Search for a document called "does not exist" and report what you find
  expected: No matching document
- name: onboard
  prompt: Set up a project for onboarding
  judge: A new space is created and three tasks are created in it
```

### Generate tasks with an agent

Good tasks measure whether the model picks the right tools with the right arguments, not whether it knows your API. You can delegate the drafting to a coding agent that has access to your MCP server's source. Give it the following prompt:

```text
Write eval tasks in eval/tasks.yaml for the MCP server in this repo.
Each task is a prompt given to an agent connected to the server, scored on the tool-call transcript.
A task has `name`, `prompt`, and exactly one of `expected` (exact string match) or `judge` (a plain-English outcome that a judge model checks against the transcript).

Read the server's tools first, then follow these rules:

- Write prompts the way a real user of the product would type them. Product vocabulary only — never tool names, parameter names, or raw internal IDs.
- Identifiers, codes, and URLs in prompts must match the product's real formats. Synthetic-looking values distort model behavior.
- Put all precision in the judge and keep prompts natural. Use `expected` only when there is one deterministic short answer.
- Score tool and argument choice, not the API. Don't ask the agent to verify its own writes; the judge sees the tool calls.
- If a prompt names data that might not exist, judge both branches: act on what the lookups found, or clearly report that it doesn't exist.
- Add a few tasks with realistic but nonexistent identifiers, judged on an honest "not found" with nothing invented.
- Cover every tool through realistic scenarios, favoring multi-step workflows. Cover reads with genuine questions, not verification chores.
- The agent can't ask questions, so include the specifics a user would give.
- Writes are real: the evals run against a live workspace.
```

Expect to iterate after the first run. Judge explanations name what failed and why, and they separate model mistakes from server bugs: a run where the model picks the right tool but every call fails points at the server, not the task. To rerun a single task while you tune it, filter by name and print its transcript:

```bash
npx mcp-eval-gateway --task task-name --limit 1 --verbose
```

## Optional: Set a system prompt

`systemPrompt` on `eval/config.ts` is extra system text sent before `EVALUATION_PROMPT` on every task. The evaluation prompt (tool-use rules and `<response>` / `<summary>` / `<feedback>` tags) always stays. When `systemPrompt` is omitted, the runner sends `EVALUATION_PROMPT` alone.

```ts
export default {
  model: 'gateway/anthropic/claude-sonnet-4-6',
  threshold: 0.8,
  systemPrompt: `You are a helpful assistant. The current date and time is ${new Date().toISOString()}.`,
  mcp: {
    url: 'http://localhost/mcp',
    headers: { Authorization: `Bearer ${process.env.MCP_API_KEY}` },
  },
};
```

The model sees that text first, then a blank line, then `EVALUATION_PROMPT`.

## Optional: Add suite hooks

`before` and `after` on `eval/config.ts` are optional async functions. The runner calls `before` once after it connects to MCP and before it runs any model. It calls `after` once after every model finishes, and also when `before` throws or a model run throws. A throw from `before` stops the suite and fails the run. A throw from `after` is reported as `Warning: after() failed: …` on the console and on the Markdown report; the runner still writes the report and still scores the suite.

```ts
export default {
  model: 'gateway/anthropic/claude-sonnet-4-6',
  threshold: 0.8,
  mcp: {
    url: 'http://localhost/mcp',
    headers: { Authorization: `Bearer ${process.env.MCP_API_KEY}` },
  },
  async before() {
    // seed or reset workspace data
  },
  async after() {
    // clean up data created by the suite
  },
};
```

## Run the evals

The default config uses a `gateway/` model (see [Choose models](#choose-models)), which needs `AI_GATEWAY_API_KEY`. Store it in a `.env` file in the project root, next to any values your config reads:

```bash
AI_GATEWAY_API_KEY=your-gateway-key
MCP_API_KEY=your-server-credential
```

Then start the runner from the project root:

```bash
npx mcp-eval-gateway
```

The runner loads `.env` when that file exists, then loads the config and `eval/tasks.yaml`. It picks the first of `config.ts`, `config.mts`, `config.mjs`, or `config.js` that exists. It evaluates every `model` in the config in one MCP session.

Accuracy is the number of passed tasks divided by the number of tasks that ran. A task passes when its score is 1. An `expected` task scores 1 on an exact match. A `judge` task scores 1 when the judge answers yes.

`threshold: 0.8` means the run must reach 80%. The process exits with status 1 when accuracy is less than `threshold`, or when a `required` task fails. A required failure fails the run even when accuracy is high enough.

The runner prints progress as it goes: a header with the model, MCP URL, and task count; a connecting line; `RUN`, then `PASS` or `FAIL`, for each task; and a summary line with the pass rate. With `--verbose`, each finished task also prints the tool name, input, and output of each call.

The Markdown report is separate from those progress lines. Set `GITHUB_STEP_SUMMARY` to a file path, and the runner appends the report to that file. The report opens with accuracy and average duration, then a tool-coverage table: every tool the server exposed, whether any task invoked it, and which tasks those were. A pass/fail index of the tasks follows, then one section per task. GitHub Actions sets `GITHUB_STEP_SUMMARY` for the job. See [Add the eval to CI](#add-the-eval-to-ci).

## Add the eval to CI

Run the eval on every pull request. The job fails when accuracy is less than `threshold`, or when a `required` task fails, and the Markdown report is attached to the job summary.

The job needs Node.js 22, the project dependencies, and the same credentials the local run uses. Store `AI_GATEWAY_API_KEY` and your server credential in the job environment. If a `.env` file is also present, values already set in the environment stay as they are.

```yaml
name: Eval

on:
  pull_request:

jobs:
  eval:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 22
      - run: npm ci
      - name: Run MCP evals
        run: npx mcp-eval-gateway
        env:
          AI_GATEWAY_API_KEY: ${{ secrets.AI_GATEWAY_API_KEY }}
          MCP_API_KEY: ${{ secrets.MCP_API_KEY }}
```

Evals call a model for every task. Set `timeout-minutes` high enough for the full suite. For how accuracy is calculated, see the [Run the evals](#run-the-evals) section of this document.

## CLI flags

The following table describes the flags:

| Flag | Purpose | Default |
| --- | --- | --- |
| `--dir DIR` | Folder under the project root that contains `config.*` and `tasks.yaml` | `eval` |
| `--env-file ENV_FILE` | Env file to load instead of `.env` | Load `.env` when that file exists |
| `--model MODEL` | Run this model only, even if it is not in the config list | Run every `model` in the config |
| `--judge-model MODEL` | Model that scores tasks with `judge` | The model under evaluation |
| `--task NAME` | Run tasks whose `name` contains this substring. Repeat the flag to OR patterns. | Run every task |
| `--limit N` | Run the first N tasks after `--task` filtering, in yaml order | Run every remaining task |
| `--verbose` | After each task's `PASS`/`FAIL` line, print that task's tool transcript (tool name, input, output) | Off |

The following command evaluates one model and loads config from `src/eval`:

```bash
npx mcp-eval-gateway \
  --dir src/eval \
  --env-file .env.local \
  --model gateway/anthropic/claude-sonnet-4-6
```

To run one matching task and print its tool transcript:

```bash
npx mcp-eval-gateway --task task-name --limit 1 --verbose
```

If `--env-file` points at a missing file, the runner exits with an error. Values already set in the process environment are not overwritten when an env file is loaded.

### Judge tasks

Tasks that set `judge` are scored by a judge model that reads the task prompt, the tool-call transcript, and the agent's final response. The runner resolves the judge model in this order: the `--judge-model` flag, the `MCP_EVAL_JUDGE_MODEL` environment variable, `judgeModel` in the eval config, then the model under evaluation.

## Choose models

`model` in `eval/config.ts` is a string, an array of strings, or a `LanguageModel` instance from the AI SDK.

Model strings have the form `PROVIDER/ID`. The prefix before the first `/` picks the provider; the rest is the model ID that provider expects. The following table lists the providers:

| Prefix | Example | Package | Credentials |
| --- | --- | --- | --- |
| `gateway/` | `gateway/anthropic/claude-sonnet-4-6` | None (built into the AI SDK) | `AI_GATEWAY_API_KEY` |
| `anthropic/` | `anthropic/claude-sonnet-4-6` | `@ai-sdk/anthropic` | `ANTHROPIC_API_KEY` |
| `openai/` | `openai/gpt-5.2` | `@ai-sdk/openai` | `OPENAI_API_KEY` |
| `bedrock/` | `bedrock/anthropic.claude-sonnet-4-5-20250929-v1:0` | `@ai-sdk/amazon-bedrock` | AWS credentials |

`init` writes a `gateway/` model. The gateway is built into the AI SDK, needs no extra package, and gives one `AI_GATEWAY_API_KEY` access to models from every provider. For the other prefixes, install the listed provider package (they are optional peer dependencies) and set its credentials.

To evaluate several models in one run, set `model` to an array. Every model runs against the same MCP session and the same tasks:

```ts
export default {
  model: [
    'gateway/anthropic/claude-sonnet-4-6',
    'gateway/openai/gpt-5.2',
  ],
  threshold: 0.8,
  mcp: {
    url: 'http://localhost/mcp',
    headers: { Authorization: `Bearer ${process.env.MCP_API_KEY}` },
  },
};
```

To run one model without editing the config, pass `--model` on the command line. A `LanguageModel` instance built in code is used as-is; strings are resolved through the preceding table.

## Call the library

For a script or Vitest file, import from `mcp-eval-gateway`. The following example connects to an MCP server, runs one task, and asserts the result:

```ts
import { toolsFromMcp, runEvals, assertEvalResult } from 'mcp-eval-gateway';

const { tools, close } = await toolsFromMcp({
  url: 'https://example.com/mcp',
  headers: { Authorization: `Bearer ${process.env.MCP_API_KEY}` },
});

try {
  const result = await runEvals({
    model: 'gateway/anthropic/claude-sonnet-4-6',
    tools,
    tasks: [
      {
        name: 'ping',
        prompt: 'Call ping and return its text',
        expected: 'pong',
      },
    ],
  });
  assertEvalResult(result, { threshold: 0.8 });
} finally {
  await close();
}
```

The following exports are available:

- `initEvalProject(rootDir, options)`: create `config.ts` and `tasks.yaml` in the eval folder. `options` can include `dir`.
- `runEvalProject(rootDir, options)`: load a project folder and run the same path as the CLI. `options` can include `dir`, `envFile`, and `model`. The loaded config can include `systemPrompt`, `before`, and `after`.
- `runEvals(options)`: run tasks against an existing tool set. Pass `model`, `tools`, and `tasks`. You can also pass `maxSteps`, `systemPrompt`, and `scorer`.
- `toolsFromMcp(options)`: connect to an MCP server and build tools. See the [*toolsFromMcp*](#toolsfrommcp) section of this document.
- `assertEvalResult(result, options)`: throw when a required task fails or accuracy is less than `threshold`.
- `resolveModel(model)`: turn a `PROVIDER/ID` string into a `LanguageModel`.
- `writeGitHubSummary(result)`: append the report to `GITHUB_STEP_SUMMARY`. The CLI already does this.
- `EVALUATION_PROMPT`: default system prompt for the agent loop.

### toolsFromMcp

`toolsFromMcp` opens an MCP session and returns `{ tools, close }` for `runEvals`. The `mcp` object in `eval/config.ts` is the same options object: pass `url` with optional `fetch` and `headers`, or pass a `transport` from the MCP SDK (stdio, SSE, or custom). The CLI already calls `toolsFromMcp` for you.

What shipped in each version is on [Releases](https://github.com/guillegette/mcp-eval-gateway/releases).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). To report a vulnerability, see [SECURITY.md](SECURITY.md).

## License

MIT
