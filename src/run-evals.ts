import { generateText, isStepCount, type LanguageModel, type ToolSet } from 'ai';
import { EVALUATION_PROMPT } from './evaluation-prompt';
import { runJudge, type TranscriptEntry } from './judge';
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
  judgeModel?: string | LanguageModel;
  onTaskStart?: (task: EvalTask, index: number, total: number) => void;
  onTaskEnd?: (result: TaskResult, index: number, total: number) => void;
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

function hasExpected(task: EvalTask): boolean {
  return task.expected !== undefined;
}

function hasJudge(task: EvalTask): boolean {
  return task.judge !== undefined;
}

function transcriptFromSteps(
  steps: Array<{
    toolCalls: Array<{ toolCallId: string; toolName: string; input: unknown }>;
    toolResults: Array<{ toolCallId: string; output: unknown }>;
  }>,
): TranscriptEntry[] {
  return steps.flatMap((step) =>
    step.toolCalls.map((toolCall) => {
      const toolResult = step.toolResults.find(
        (result) => result.toolCallId === toolCall.toolCallId,
      );
      return {
        tool: toolCall.toolName,
        input: toolCall.input,
        output: toolResult?.output,
      };
    }),
  );
}

export async function runEvals(options: RunEvalsOptions): Promise<EvalRunResult> {
  if (options.tasks.length === 0) {
    throw new Error('No tasks ran');
  }

  for (const task of options.tasks) {
    if (hasExpected(task) === hasJudge(task)) {
      throw new Error(`Task "${task.name}" must set exactly one of expected or judge`);
    }
  }

  const model =
    typeof options.model === 'string' ? await resolveModel(options.model) : options.model;

  const needsJudge = options.tasks.some((task) => hasJudge(task) && task.scorer === undefined);
  const resolvedJudgeModel =
    !needsJudge || options.judgeModel === undefined
      ? model
      : typeof options.judgeModel === 'string'
        ? await resolveModel(options.judgeModel)
        : options.judgeModel;

  const results: TaskResult[] = [];
  const totalTasks = options.tasks.length;

  for (const [index, task] of options.tasks.entries()) {
    await task.setup?.();

    const toolMetrics: ToolMetrics = {};
    const wrappedTools = wrapTools(options.tools, toolMetrics);
    const started = performance.now();

    options.onTaskStart?.(task, index, totalTasks);

    const generated = await generateText({
      model,
      system: options.systemPrompt ?? EVALUATION_PROMPT,
      prompt: task.prompt,
      tools: wrappedTools,
      stopWhen: isStepCount(options.maxSteps ?? 20),
    });

    const durationMs = performance.now() - started;
    const actual = extractTag(generated.text, 'response');
    const transcript = transcriptFromSteps(generated.steps);

    let score: number;
    let judgeReason: string | null = null;
    if (hasJudge(task) && task.scorer === undefined) {
      const judged = await runJudge({
        model: resolvedJudgeModel,
        task,
        transcript,
        actual,
      });
      score = judged.score;
      judgeReason = judged.reason;
    } else {
      const scorer = task.scorer ?? options.scorer ?? defaultScorer;
      score = scorer(actual, task);
    }
    const passed = score >= 1;
    const numToolCalls = Object.values(toolMetrics).reduce(
      (sum, metric) => sum + metric.count,
      0,
    );

    const taskResult: TaskResult = {
      name: task.name,
      prompt: task.prompt,
      expected: task.expected ?? null,
      judge: task.judge ?? null,
      judgeReason,
      actual,
      score,
      passed,
      required: task.required ?? false,
      durationMs,
      toolMetrics,
      numToolCalls,
      summary: extractTag(generated.text, 'summary'),
      feedback: extractTag(generated.text, 'feedback'),
      transcript,
    };
    options.onTaskEnd?.(taskResult, index, totalTasks);
    results.push(taskResult);
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
