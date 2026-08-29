import type { LanguageModel } from 'ai';
import { createJiti } from 'jiti';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import { toolsFromMcp, type ToolsFromMcpOptions } from './mcp-tools';
import { runEvals } from './run-evals';
import { assertEvalResult, writeGitHubSummary } from './threshold';
import type { EvalRunResult, EvalTask } from './types';

const CONFIG_PATHS = [
  'eval/config.ts',
  'eval/config.mts',
  'eval/config.mjs',
  'eval/config.js',
] as const;

type EvalProjectConfig = {
  model: string | LanguageModel;
  threshold?: number;
  mcp: ToolsFromMcpOptions;
};

function resolveConfigPath(rootDir: string): string {
  for (const relative of CONFIG_PATHS) {
    const abs = join(rootDir, relative);
    if (existsSync(abs)) {
      return abs;
    }
  }
  throw new Error(
    `No eval/config found. Expected one of: ${CONFIG_PATHS.join(', ')}`,
  );
}

async function loadConfig(abs: string): Promise<EvalProjectConfig> {
  const ext = extname(abs);
  if (ext === '.ts' || ext === '.mts') {
    const jiti = createJiti(abs, { moduleCache: false });
    const loaded = (await jiti.import(abs)) as { default: EvalProjectConfig };
    return loaded.default;
  }
  const loaded = (await import(pathToFileURL(abs).href)) as {
    default: EvalProjectConfig;
  };
  return loaded.default;
}

function requireStringField(item: Record<string, unknown>, field: string): string {
  const value = item[field];
  if (typeof value !== 'string') {
    throw new Error(`eval/tasks.yaml item is missing ${field}`);
  }
  return value;
}

function loadTasks(rootDir: string): EvalTask[] {
  const tasksPath = join(rootDir, 'eval/tasks.yaml');
  if (!existsSync(tasksPath)) {
    throw new Error('Missing eval/tasks.yaml');
  }

  const parsed: unknown = parse(readFileSync(tasksPath, 'utf8'));
  if (!Array.isArray(parsed)) {
    throw new Error('eval/tasks.yaml must be an array');
  }

  return parsed.map((item: unknown) => {
    if (typeof item !== 'object' || item === null) {
      throw new Error('eval/tasks.yaml item is missing name');
    }
    const record = item as Record<string, unknown>;
    return {
      name: requireStringField(record, 'name'),
      prompt: requireStringField(record, 'prompt'),
      expected: requireStringField(record, 'expected'),
      required: record.required === true,
    };
  });
}

export async function runEvalProject(rootDir: string): Promise<EvalRunResult> {
  const config = await loadConfig(resolveConfigPath(rootDir));
  const tasks = loadTasks(rootDir);
  const session = await toolsFromMcp(config.mcp);
  try {
    const result = await runEvals({
      model: config.model,
      tools: session.tools,
      tasks,
    });
    writeGitHubSummary(result);
    assertEvalResult(
      result,
      config.threshold === undefined ? undefined : { threshold: config.threshold },
    );
    return result;
  } finally {
    await session.close();
  }
}
