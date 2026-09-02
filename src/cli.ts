#!/usr/bin/env node

import { initEvalProject } from './init-eval-project';
import { parseEvalCli } from './parse-cli';
import { createReporter } from './reporter';
import { runEvalProject } from './run-eval-project';

function fail(error: unknown): never {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}

let parsed;
try {
  parsed = parseEvalCli(process.argv.slice(2));
} catch (error: unknown) {
  fail(error);
}

if (parsed.command === 'unknown') {
  process.stderr.write(`Unknown command: ${parsed.positional}\n`);
  process.exit(1);
}

if (parsed.command === 'init') {
  try {
    initEvalProject(process.cwd(), { dir: parsed.dir });
    process.stdout.write(
      `Created ${parsed.dir ?? 'eval'}/config.ts and ${parsed.dir ?? 'eval'}/tasks.yaml\n`,
    );
    process.exit(0);
  } catch (error: unknown) {
    fail(error);
  }
}

runEvalProject(process.cwd(), {
  dir: parsed.dir,
  envFile: parsed.envFile,
  model: parsed.model,
  judgeModel: parsed.judgeModel,
  task: parsed.task,
  limit: parsed.limit,
  reporter: createReporter((chunk) => process.stdout.write(chunk), {
    verbose: parsed.verbose === true,
  }),
})
  .then(() => {
    process.exit(0);
  })
  .catch((error: unknown) => {
    fail(error);
  });
