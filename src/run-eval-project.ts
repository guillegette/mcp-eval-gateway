import type { LanguageModel } from 'ai';
import { createJiti } from 'jiti';
import { existsSync, readFileSync } from 'node:fs';
import { extname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import { toolsFromMcp, type ToolsFromMcpOptions } from './mcp-tools';
import { runEvals } from './run-evals';
import { assertEvalResult, writeGitHubSummary } from './threshold';
import type { EvalRunResult, EvalTask } from './types';

const CONFIG_FILES = [
  'config.ts',
  'config.mts',
  'config.mjs',
  'config.js',
] as const;

export type RunEvalProjectOptions = {
  dir?: string;
  envFile?: string;
  model?: string;
  judgeModel?: string;
};

type EvalProjectModel = string | LanguageModel;

type EvalProjectConfig = {
  model: EvalProjectModel | EvalProjectModel[];
  judgeModel?: string;
  threshold?: number;
  mcp: ToolsFromMcpOptions;
};

function loadEnv(rootDir: string, options?: RunEvalProjectOptions): void {
  const envFile = options?.envFile;
  if (envFile !== undefined) {
    const abs = isAbsolute(envFile) ? envFile : resolve(rootDir, envFile);
    if (!existsSync(abs)) {
      throw new Error(`Missing env file: ${envFile}`);
    }
    process.loadEnvFile(abs);
    return;
  }

  const dotenv = join(rootDir, '.env');
  if (existsSync(dotenv)) {
    process.loadEnvFile(dotenv);
  }
}

function resolveConfigPath(evalDir: string, relativeDir: string): string {
  for (const filename of CONFIG_FILES) {
    const abs = join(evalDir, filename);
    if (existsSync(abs)) {
      return abs;
    }
  }
  const relatives = CONFIG_FILES.map((filename) => `${relativeDir}/${filename}`);
  throw new Error(
    `No ${relativeDir}/config found. Expected one of: ${relatives.join(', ')}`,
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

function requireStringField(
  item: Record<string, unknown>,
  field: string,
  relativeDir: string,
): string {
  const value = item[field];
  if (typeof value !== 'string') {
    throw new Error(`${relativeDir}/tasks.yaml item is missing ${field}`);
  }
  return value;
}

function optionalStringField(
  item: Record<string, unknown>,
  field: string,
  relativeDir: string,
): string | undefined {
  if (item[field] === undefined) {
    return undefined;
  }
  return requireStringField(item, field, relativeDir);
}

function loadTasks(evalDir: string, relativeDir: string): EvalTask[] {
  const tasksPath = join(evalDir, 'tasks.yaml');
  if (!existsSync(tasksPath)) {
    throw new Error(`Missing ${relativeDir}/tasks.yaml`);
  }

  const parsed: unknown = parse(readFileSync(tasksPath, 'utf8'));
  if (!Array.isArray(parsed)) {
    throw new Error(`${relativeDir}/tasks.yaml must be an array`);
  }

  return parsed.map((item: unknown) => {
    if (typeof item !== 'object' || item === null) {
      throw new Error(`${relativeDir}/tasks.yaml item is missing name`);
    }
    const record = item as Record<string, unknown>;
    const expected = optionalStringField(record, 'expected', relativeDir);
    const judge = optionalStringField(record, 'judge', relativeDir);
    if ((expected === undefined) === (judge === undefined)) {
      throw new Error(
        `${relativeDir}/tasks.yaml item must set exactly one of expected or judge`,
      );
    }
    return {
      name: requireStringField(record, 'name', relativeDir),
      prompt: requireStringField(record, 'prompt', relativeDir),
      ...(expected !== undefined ? { expected } : {}),
      ...(judge !== undefined ? { judge } : {}),
      required: record.required === true,
    };
  });
}

export async function runEvalProject(
  rootDir: string,
  options?: RunEvalProjectOptions,
): Promise<EvalRunResult> {
  loadEnv(rootDir, options);

  const relativeDir = options?.dir ?? 'eval';
  const evalDir = join(rootDir, relativeDir);
  const config = await loadConfig(resolveConfigPath(evalDir, relativeDir));
  const judgeModel = options?.judgeModel ?? process.env.MCP_EVAL_JUDGE_MODEL ?? config.judgeModel;
  const tasks = loadTasks(evalDir, relativeDir);
  const models = options?.model !== undefined
    ? [options.model]
    : Array.isArray(config.model)
      ? config.model
      : [config.model];
  if (models.length === 0) {
    throw new Error('model is empty');
  }

  const session = await toolsFromMcp(config.mcp);
  try {
    const results: EvalRunResult[] = [];
    for (const entry of models) {
      results.push(
        await runEvals({
          model: entry,
          tools: session.tools,
          tasks,
          judgeModel,
        }),
      );
    }

    for (const result of results) {
      writeGitHubSummary(result);
    }

    const assertOptions =
      config.threshold === undefined ? undefined : { threshold: config.threshold };
    const assertErrors: Error[] = [];
    for (const result of results) {
      try {
        assertEvalResult(result, assertOptions);
      } catch (err) {
        assertErrors.push(err instanceof Error ? err : new Error(String(err)));
      }
    }
    if (assertErrors.length > 0) {
      throw new Error(assertErrors.map((err) => err.message).join('\n'));
    }

    return results[results.length - 1];
  } finally {
    await session.close();
  }
}
