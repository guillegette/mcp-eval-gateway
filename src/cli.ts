#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { initEvalProject } from './init-eval-project';
import { runEvalProject } from './run-eval-project';

function parseCli() {
  try {
    return parseArgs({
      allowPositionals: true,
      options: {
        dir: { type: 'string' },
        'env-file': { type: 'string' },
        model: { type: 'string' },
        'judge-model': { type: 'string' },
      },
    });
  } catch (error: unknown) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}

const { values, positionals } = parseCli();

if (positionals[0] === 'init') {
  try {
    initEvalProject(process.cwd(), { dir: values.dir });
    process.stdout.write(
      `Created ${values.dir ?? 'eval'}/config.ts and ${values.dir ?? 'eval'}/tasks.yaml\n`,
    );
    process.exit(0);
  } catch (error: unknown) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
} else if (typeof positionals[0] === 'string') {
  process.stderr.write(`Unknown command: ${positionals[0]}\n`);
  process.exit(1);
} else {
  runEvalProject(process.cwd(), {
    dir: values.dir,
    envFile: values['env-file'],
    model: values.model,
    judgeModel: values['judge-model'],
  })
    .then(() => {
      process.exit(0);
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
