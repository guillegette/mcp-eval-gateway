import { generateText, isStepCount, type LanguageModel, type ToolSet } from 'ai';
import { EVALUATION_PROMPT } from './evaluation-prompt';
import { renderReport } from './report';
import { resolveModel } from './resolve-model';
import type { EvalRunResult, EvalTask, TaskResult, ToolMetrics } from './types';

export type RunEvalsOptions = {
  model: string | LanguageModel;
  tools: ToolSet;
  tasks: EvalTask[];
  maxSteps?: number;
  systemPrompt?: string;
  scorer?: (actual: string | null, task: EvalTask) => number;
};

const defaultScorer = (actual: string | null, task: EvalTask): number =>
  actual === task.expected ? 1 : 0;

function extractTag(text: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g');
  let last: string | null = null;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    last = match[1] ?? null;
  }
  return last === null ? null : last.trim();
}

function wrapTools(tools: ToolSet, metrics: ToolMetrics): ToolSet {
  const wrapped: ToolSet = {};

  for (const [name, tool] of Object.entries(tools)) {
    const originalExecute = tool.execute;
    wrapped[name] = {
      ...tool,
      execute: async (input, options) => {
        const start = performance.now();
        try {
          return await originalExecute?.(input, options);
        } catch (error) {
          return `Error executing tool ${name}: ${
            error instanceof Error ? error.message : String(error)
          }`;
        } finally {
          const bucket = metrics[name] ?? { count: 0, durationsMs: [] };
          bucket.count += 1;
          bucket.durationsMs.push(performance.now() - start);
          metrics[name] = bucket;
        }
      },
    };
  }

  return wrapped;
}

export async function runEvals(options: RunEvalsOptions): Promise<EvalRunResult> {
  if (options.tasks.length === 0) {
    throw new Error('No tasks ran');
  }

  const model =
    typeof options.model === 'string' ? await resolveModel(options.model) : options.model;

  const results: TaskResult[] = [];

  for (const task of options.tasks) {
    await task.setup?.();

    const toolMetrics: ToolMetrics = {};
    const wrappedTools = wrapTools(options.tools, toolMetrics);
    const started = performance.now();

    const generated = await generateText({
      model,
      system: options.systemPrompt ?? EVALUATION_PROMPT,
      prompt: task.prompt,
      tools: wrappedTools,
      stopWhen: isStepCount(options.maxSteps ?? 20),
    });

    const durationMs = performance.now() - started;
    const actual = extractTag(generated.text, 'response');
    const scorer = task.scorer ?? options.scorer ?? defaultScorer;
    const score = scorer(actual, task);
    const passed = score >= 1;
    const numToolCalls = Object.values(toolMetrics).reduce(
      (sum, metric) => sum + metric.count,
      0,
    );

    results.push({
      name: task.name,
      prompt: task.prompt,
      expected: task.expected,
      actual,
      score,
      passed,
      required: task.required ?? false,
      durationMs,
      toolMetrics,
      numToolCalls,
      summary: extractTag(generated.text, 'summary'),
      feedback: extractTag(generated.text, 'feedback'),
    });
  }

  const total = results.length;
  const correct = results.filter((result) => result.passed).length;

  return {
    total,
    correct,
    accuracy: correct / total,
    results,
    report: renderReport(results),
  };
}
