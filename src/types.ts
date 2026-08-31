export type EvalTask = {
  name: string;
  prompt: string;
  expected?: string;
  judge?: string;
  required?: boolean;
  setup?: () => void | Promise<void>;
  scorer?: (actual: string | null, task: EvalTask) => number;
};

export type ToolMetrics = Record<string, { count: number; durationsMs: number[] }>;

export type TaskResult = {
  name: string;
  prompt: string;
  expected: string | null;
  judge: string | null;
  judgeReason: string | null;
  actual: string | null;
  score: number;
  passed: boolean;
  required: boolean;
  durationMs: number;
  toolMetrics: ToolMetrics;
  numToolCalls: number;
  summary: string | null;
  feedback: string | null;
};

export type EvalRunResult = {
  total: number;
  correct: number;
  accuracy: number;
  results: TaskResult[];
  report: string;
};
