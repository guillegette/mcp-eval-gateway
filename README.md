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

Add two files under `eval/`, then run the CLI.

1. `eval/config.ts` (or `.mts` / `.mjs` / `.js`):

```ts
import { POST } from '../app/mcp/route.js';

export default {
  model: 'gateway/anthropic/claude-sonnet-4-6',
  threshold: 0.8,
  mcp: {
    url: 'http://localhost/mcp',
    fetch: (input: string | URL, init?: RequestInit) => POST(new Request(input, init)),
    headers: { Authorization: `Bearer ${process.env.YOUR_MCP_KEY}` },
  },
};
```

`mcp` is the same options object as `toolsFromMcp`: `{ url, headers? }`, `{ url, fetch, headers? }`, or `{ transport }`. `YOUR_MCP_KEY` is whatever your MCP server expects — not a package env var.

2. `eval/tasks.yaml` — a top-level array:

```yaml
- name: ping
  prompt: Call the ping tool and return its text
  expected: pong
  required: true
```

Each item has `name`, `prompt`, `expected`, and an optional `required` boolean.

3. From the project root (the directory that contains `eval/`):

```bash
npx mcp-eval-gateway@0.1.0
```

Pass the same env vars your model and `eval/config` need, for example `AI_GATEWAY_API_KEY` and `YOUR_MCP_KEY`. The process exits `1` below `threshold` or when a `required` task fails.

## GitHub Actions

After checkout, setup-node 22, and `npm ci`, add this eval step (pin the version):

```yaml
- run: npx mcp-eval-gateway@0.1.0
  env:
    AI_GATEWAY_API_KEY: ${{ secrets.AI_GATEWAY_API_KEY }}
    YOUR_MCP_KEY: ${{ secrets.YOUR_MCP_KEY }}
```

The runner writes the markdown report to the Actions job summary when GitHub provides it, and fails the job below `threshold` or when a `required` task fails.

## Models

`runEvals` accepts a `LanguageModel` instance or a string of the form `<provider>/<id>` (split on the first `/` only):


| Prefix       | Example                                             | Package                  | Credentials          |
| ------------ | --------------------------------------------------- | ------------------------ | -------------------- |
| `anthropic/` | `anthropic/claude-sonnet-4-6`                       | `@ai-sdk/anthropic`      | `ANTHROPIC_API_KEY`  |
| `openai/`    | `openai/gpt-5.2`                                    | `@ai-sdk/openai`         | `OPENAI_API_KEY`     |
| `bedrock/`   | `bedrock/anthropic.claude-sonnet-4-5-20250929-v1:0` | `@ai-sdk/amazon-bedrock` | AWS credentials      |
| `gateway/`   | `gateway/anthropic/claude-sonnet-4-6`               | none (AI SDK built-in)   | `AI_GATEWAY_API_KEY` |


Provider packages are optional peer dependencies — install only the prefix you use. `gateway/` uses the AI SDK built-in with no extra package. A `LanguageModel` instance is also accepted and used as-is.

## Manual API

For a script or vitest file, import from `mcp-eval-gateway`:

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
