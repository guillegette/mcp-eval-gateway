# mcp-eval-gateway

Run LLM tool-use evaluations against MCP servers with the [Vercel AI SDK](https://ai-sdk.dev/). The agent loop, tagged response extraction, scoring, and markdown report follow Anthropic's [tool_evaluation cookbook](https://github.com/anthropics/anthropic-cookbook) pattern.

## Install

```bash
npm install --save-dev mcp-eval-gateway
```

That pulls in the Vercel AI SDK. For `anthropic/`, `openai/`, or `bedrock/` model strings, also install that provider package, for example:

```bash
npm install --save-dev @ai-sdk/anthropic
```

`gateway/` strings need no extra package.

## Quick start

1. `eval/config.ts` (or `.mts` / `.mjs` / `.js`) — default export with `model` as a string **or** an array of strings (or a LanguageModel):

```ts
import { POST } from '../app/mcp/route.js';

export default {
  model: [
    'gateway/anthropic/claude-sonnet-4-6',
    'gateway/openai/gpt-5.2',
  ],
  threshold: 0.8,
  mcp: {
    url: 'http://localhost/mcp',
    fetch: (input: string | URL, init?: RequestInit) => POST(new Request(input, init)),
    headers: { Authorization: `Bearer ${process.env.YOUR_MCP_KEY}` },
  },
};
```

`mcp` is the same options object as `toolsFromMcp`. `YOUR_MCP_KEY` is whatever your MCP server expects — not a package env var.

2. `eval/tasks.yaml` — a top-level array:

```yaml
- name: ping
  prompt: Call the ping tool and return its text
  expected: pong
  required: true
```

Each item has `name`, `prompt`, `expected`, and an optional `required` boolean.

3. From the directory you want as the project root (the process cwd):

```bash
npx mcp-eval-gateway@0.1.0
```

The runner loads `.env` from that directory when the file exists, then loads `eval/config.*` + `eval/tasks.yaml`. It runs every `model` in the config, writes reports, and exits `1` if any model fails `threshold` or a `required` task. Put `AI_GATEWAY_API_KEY` and `YOUR_MCP_KEY` in `.env` locally.

## CLI

Each flag takes one value.

| Flag | Maps to | Default / behavior |
| --- | --- | --- |
| `--dir <path>` | folder under cwd that contains `config.*` and `tasks.yaml` | `eval` |
| `--env-file <path>` | env file to load instead of `.env` | load `.env` if present |
| `--model <id>` | run this model only, even if it is not in the config list | run every `model` in the config |

```bash
npx mcp-eval-gateway@0.1.0 --dir src/eval --env-file .env.local --model gateway/anthropic/claude-sonnet-4-6
```

## GitHub Actions

After checkout, setup-node 22, and `npm ci`, add this eval step (pin the version):

```yaml
- run: npx mcp-eval-gateway@0.1.0
  env:
    AI_GATEWAY_API_KEY: ${{ secrets.AI_GATEWAY_API_KEY }}
    YOUR_MCP_KEY: ${{ secrets.YOUR_MCP_KEY }}
```

The job can inject env instead of a `.env` file; already-set env vars are not overwritten by `.env`. The runner writes the markdown report to the Actions job summary when GitHub provides it, and fails the job below `threshold` or when a `required` task fails.

## Models

`runEvals` accepts a `LanguageModel` instance or a string of the form `<provider>/<id>` (split on the first `/` only). Config `model` may be that value or an array of them; CLI `--model` selects one id to run.


| Prefix       | Example                                             | Package                  | Credentials          |
| ------------ | --------------------------------------------------- | ------------------------ | -------------------- |
| `anthropic/` | `anthropic/claude-sonnet-4-6`                       | `@ai-sdk/anthropic`      | `ANTHROPIC_API_KEY`  |
| `openai/`    | `openai/gpt-5.2`                                    | `@ai-sdk/openai`         | `OPENAI_API_KEY`     |
| `bedrock/`   | `bedrock/anthropic.claude-sonnet-4-5-20250929-v1:0` | `@ai-sdk/amazon-bedrock` | AWS credentials      |
| `gateway/`   | `gateway/anthropic/claude-sonnet-4-6`               | none (AI SDK built-in)   | `AI_GATEWAY_API_KEY` |


Provider packages are optional peer dependencies — install only the prefix you use. `gateway/` uses the AI SDK built-in with no extra package. A `LanguageModel` instance is also accepted and used as-is.

## Manual API

For a script or vitest file, import from `mcp-eval-gateway`:

- `runEvalProject(rootDir, { dir?, envFile?, model? })`
- `runEvals({ model, tools, tasks, maxSteps?, systemPrompt?, scorer? })`
- `toolsFromMcp({ url, fetch?, headers? } | { transport })`
- `assertEvalResult(result, { threshold? })`
- `resolveModel(model)`
- `writeGitHubSummary(result)` — optional; the CLI already does this
- `EVALUATION_PROMPT`

```ts
import { toolsFromMcp, runEvals, assertEvalResult } from 'mcp-eval-gateway';

const { tools, close } = await toolsFromMcp({
  url: 'https://example.com/mcp',
  headers: { Authorization: `Bearer ${process.env.YOUR_MCP_KEY}` },
});

try {
  const result = await runEvals({
    model: 'gateway/anthropic/claude-sonnet-4-6',
    tools,
    tasks: [{ name: 'ping', prompt: 'Call ping and return its text', expected: 'pong' }],
  });
  assertEvalResult(result, { threshold: 0.8 });
} finally {
  await close();
}
```

## License

MIT
