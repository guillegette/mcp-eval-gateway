#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { runEvalProject, type RunEvalProjectOptions } from './run-eval-project';

function parseCliOptions(): RunEvalProjectOptions {
  try {
    const { values } = parseArgs({
      options: {
        dir: { type: 'string' },
        'env-file': { type: 'string' },
        model: { type: 'string' },
      },
    });
    return {
      dir: values.dir,
      envFile: values['env-file'],
      model: values.model,
    };
  } catch (error: unknown) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}

runEvalProject(process.cwd(), parseCliOptions())
  .then(() => {
    process.exit(0);
  })
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
