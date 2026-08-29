#!/usr/bin/env node

import { runEvalProject } from './run-eval-project';

runEvalProject(process.cwd())
  .then(() => {
    process.exit(0);
  })
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
