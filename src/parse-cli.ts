import { parseArgs } from 'node:util';

export type ParsedEvalCli = {
  command: 'init' | 'run' | 'unknown';
  positional?: string;
  dir?: string;
  envFile?: string;
  model?: string;
  judgeModel?: string;
  task?: string[];
  limit?: number;
  verbose?: boolean;
};

export function parseEvalCli(args: string[]): ParsedEvalCli {
  const { values, positionals } = parseArgs({
    args,
    strict: true,
    allowPositionals: true,
    options: {
      dir: { type: 'string' },
      'env-file': { type: 'string' },
      model: { type: 'string' },
      'judge-model': { type: 'string' },
      task: { type: 'string', multiple: true },
      limit: { type: 'string' },
      verbose: { type: 'boolean' },
    },
  });

  if (typeof positionals[0] === 'string' && positionals[0] !== 'init') {
    return { command: 'unknown', positional: positionals[0] };
  }

  const parsed: ParsedEvalCli = {
    command: positionals[0] === 'init' ? 'init' : 'run',
  };

  if (values.dir !== undefined) {
    parsed.dir = values.dir;
  }
  if (values['env-file'] !== undefined) {
    parsed.envFile = values['env-file'];
  }
  if (values.model !== undefined) {
    parsed.model = values.model;
  }
  if (values['judge-model'] !== undefined) {
    parsed.judgeModel = values['judge-model'];
  }
  if (values.task !== undefined) {
    parsed.task = values.task;
  }
  if (values.verbose === true) {
    parsed.verbose = true;
  }
  if (values.limit !== undefined) {
    const n = Number(values.limit);
    if (!Number.isInteger(n) || n < 1) {
      throw new Error(`--limit must be an integer >= 1, got ${values.limit}`);
    }
    parsed.limit = n;
  }

  return parsed;
}
