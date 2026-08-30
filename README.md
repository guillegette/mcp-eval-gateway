# mcp-eval-gateway

Run LLM tool-use evaluations against MCP servers with the [Vercel AI SDK](https://ai-sdk.dev/). The agent loop, tagged response extraction, scoring, and Markdown report follow the pattern in Anthropic's [tool evaluation cookbook](https://github.com/anthropics/anthropic-cookbook).

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

These files are a starting point. Point the config at your MCP server, write the tasks you want to evaluate, then run the evals. The next three sections cover each step.

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

Pass `fetch` that calls your route handler. No network hop. This is the Next.js App Router pattern.

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

`eval/tasks.yaml` lists the tasks the model must complete against your server's tools. Each task must include `name`, `prompt`, and `expected`. The runner sends `prompt` to the model with the MCP tools available and scores the final response against `expected`. Set `required` to `true` when a failed task must fail the run.

```yaml
- name: ping
  prompt: Call the ping tool and return its text
  expected: pong
  required: true
- name: search-empty
  prompt: Search for a document called "does not exist" and report what you find
  expected: No matching document
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

The runner loads `.env` when that file exists, then loads the config and `eval/tasks.yaml`. It picks the first of `config.ts`, `config.mts`, `config.mjs`, or `config.js` that exists. It evaluates every `model` in the config in one MCP session, writes a Markdown report, and exits with status 1 if any model fails `threshold` or a `required` task.

## CLI flags

Each flag takes one value. The following table describes the flags:

| Flag | Purpose | Default |
| --- | --- | --- |
| `--dir DIR` | Folder under the project root that contains `config.*` and `tasks.yaml` | `eval` |
| `--env-file ENV_FILE` | Env file to load instead of `.env` | Load `.env` when that file exists |
| `--model MODEL` | Run this model only, even if it is not in the config list | Run every `model` in the config |

The following command evaluates one model and loads config from `src/eval`:

```bash
npx mcp-eval-gateway \
  --dir src/eval \
  --env-file .env.local \
  --model gateway/anthropic/claude-sonnet-4-6
```

If `--env-file` points at a missing file, the runner exits with an error. Values already set in the process environment are not overwritten when an env file is loaded.

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

To run one model without editing the config, pass `--model` on the command line. A `LanguageModel` instance built in code is used as-is; strings are resolved through the table above.

## Add a GitHub Actions step

After checkout, Node.js 22 setup, and `npm ci`, add an eval step. Pass secrets through the job environment instead of a `.env` file:

```yaml
- name: Run MCP evals
  run: npx mcp-eval-gateway
  env:
    AI_GATEWAY_API_KEY: ${{ secrets.AI_GATEWAY_API_KEY }}
    MCP_API_KEY: ${{ secrets.MCP_API_KEY }}
```

When GitHub provides `GITHUB_STEP_SUMMARY`, the runner writes the Markdown report to the job summary. The step fails when accuracy is below `threshold` or when a `required` task fails.

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
- `runEvalProject(rootDir, options)`: load a project folder and run the same path as the CLI. `options` can include `dir`, `envFile`, and `model`.
- `runEvals(options)`: run tasks against an existing tool set. Pass `model`, `tools`, and `tasks`. You can also pass `maxSteps`, `systemPrompt`, and `scorer`.
- `toolsFromMcp(options)`: connect to an MCP server and build tools. See the [*toolsFromMcp*](#toolsfrommcp) section of this document.
- `assertEvalResult(result, options)`: throw when a required task fails or accuracy is below `threshold`.
- `resolveModel(model)`: turn a `PROVIDER/ID` string into a `LanguageModel`.
- `writeGitHubSummary(result)`: append the report to `GITHUB_STEP_SUMMARY`. The CLI already does this.
- `EVALUATION_PROMPT`: default system prompt for the agent loop.

### toolsFromMcp

`toolsFromMcp` opens an MCP session and returns `{ tools, close }` for `runEvals`. The `mcp` object in `eval/config.ts` is the same options object: pass `url` with optional `fetch` and `headers`, or pass a `transport` from the MCP SDK (stdio, SSE, or custom). The CLI already calls `toolsFromMcp` for you.

## License

MIT
