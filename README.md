# mcp-eval-gateway

Run LLM tool-use evaluations against MCP servers with the [Vercel AI SDK](https://ai-sdk.dev/). The agent loop, tagged response extraction, scoring, and markdown report follow Anthropic's [tool_evaluation cookbook](https://github.com/anthropics/anthropic-cookbook) pattern.

A consumer defines eval tasks (prompt + expected answer), sources tools from an MCP server (over HTTP, or in-process via a custom `fetch`), and calls `runEvals`. The result includes per-task scores, tool-call metrics, the model's self-reported summary and feedback, and a markdown report. `assertEvalResult` fails CI below a pass-rate threshold or when a required task fails.

## Install

```bash
npm install --save-dev mcp-eval-gateway ai
```

Also install the optional provider package for the model string you use, for example:

```bash
npm install --save-dev @ai-sdk/anthropic
```

## Quick start

```ts
import { runEvals, assertEvalResult, type EvalTask } from 'mcp-eval-gateway';

const tasks: EvalTask[] = [
  {
    name: 'answer-42',
    prompt: 'What is 6*7?',
    expected: '42',
  },
];

const result = await runEvals({
  model: 'anthropic/claude-sonnet-4-6',
  tools,
  tasks,
});

assertEvalResult(result, { threshold: 0.8 });
```

`runEvals` resolves a string model once, runs each task through `generateText` with the evaluation system prompt, extracts the last `<response>`, `<summary>`, and `<feedback>` tags, and scores by exact match unless you pass a task-level or run-level `scorer`.

## Models

`runEvals` accepts a `LanguageModel` instance or a string of the form `<provider>/<id>` (split on the first `/` only):

| Prefix | Example | Package | Credentials |
| --- | --- | --- | --- |
| `anthropic/` | `anthropic/claude-sonnet-4-6` | `@ai-sdk/anthropic` | `ANTHROPIC_API_KEY` |
| `openai/` | `openai/gpt-5.2` | `@ai-sdk/openai` | `OPENAI_API_KEY` |
| `bedrock/` | `bedrock/anthropic.claude-sonnet-4-5-20250929-v1:0` | `@ai-sdk/amazon-bedrock` | AWS credentials |
| `gateway/` | `gateway/anthropic/claude-sonnet-4-6` | none (AI SDK built-in) | `AI_GATEWAY_API_KEY` |

Provider packages are optional peer dependencies. Install only the one(s) your model strings use. A `LanguageModel` instance is also accepted and used as-is.

## Tools from an MCP server

Over HTTP:

```ts
import { toolsFromMcp } from 'mcp-eval-gateway';

const { tools, close } = await toolsFromMcp({
  url: 'https://example.com/mcp',
  headers: { Authorization: 'Bearer …' },
});

try {
  const result = await runEvals({ model: 'anthropic/claude-sonnet-4-6', tools, tasks });
  assertEvalResult(result, { threshold: 0.8 });
} finally {
  await close();
}
```

For a serverless MCP handler, pass a custom `fetch` that invokes the handler directly (no listening HTTP server):

```ts
const { tools, close } = await toolsFromMcp({
  url: 'http://localhost/mcp',
  fetch: (input, init) => POST(new Request(input, init)),
  headers: { Authorization: 'Bearer test-api-key' },
});
```

## GitHub Actions

Run evals as a vitest suite or script. Store the provider API key as a repository secret and pass it into the job environment.

Use `writeGitHubSummary(result)` to append the markdown report to the job summary (`GITHUB_STEP_SUMMARY`). `assertEvalResult(result, { threshold })` throws when accuracy is below the threshold or a `required: true` task fails, so the job exits non-zero.

```ts
import { runEvals, assertEvalResult, writeGitHubSummary } from 'mcp-eval-gateway';

const result = await runEvals({ model: 'anthropic/claude-sonnet-4-6', tools, tasks });
writeGitHubSummary(result);
assertEvalResult(result, { threshold: 0.8 });
```

## License

MIT
