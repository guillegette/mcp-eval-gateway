import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toolsFromMcp } from '../src/mcp-tools';
import { runEvals } from '../src/run-evals';
import { assertEvalResult, writeGitHubSummary } from '../src/threshold';
import type { EvalRunResult } from '../src/types';
import { runEvalProject } from '../src/index';

vi.mock('../src/run-evals', () => ({
  runEvals: vi.fn(),
}));

vi.mock('../src/mcp-tools', () => ({
  toolsFromMcp: vi.fn(),
}));

vi.mock('../src/threshold', () => ({
  assertEvalResult: vi.fn(),
  writeGitHubSummary: vi.fn(),
}));

const previousSummary = process.env.GITHUB_STEP_SUMMARY;
const previousMcpKey = process.env.YOUR_MCP_KEY;
const previousJudgeModel = process.env.MCP_EVAL_JUDGE_MODEL;

const evalRunResult: EvalRunResult = {
  total: 1,
  correct: 1,
  accuracy: 1,
  results: [],
  report: 'eval report',
};

const pingTasksYaml = `- name: ping
  prompt: hi
  expected: pong
`;

const multiTasksYaml = `- name: ping
  prompt: hi
  expected: pong
- name: url-paste-space
  prompt: hi
  expected: ok
- name: url-paste-task-panel
  prompt: hi
  expected: ok
`;

const defaultConfig = `export default { model: 'gateway/x', mcp: { url: 'http://localhost/mcp' } };
`;

type RunEvalCallbacks = {
  onTaskStart?: unknown;
  onTaskEnd?: unknown;
  tasks: Array<{ name: string }>;
};

type RunEvalProjectFilterOptions = NonNullable<Parameters<typeof runEvalProject>[1]> & {
  task?: string[];
  limit?: number;
  reporter?: {
    onRunStart: ReturnType<typeof vi.fn>;
    onPhase: ReturnType<typeof vi.fn>;
    onTaskStart: ReturnType<typeof vi.fn>;
    onTaskEnd: ReturnType<typeof vi.fn>;
    onRunEnd: ReturnType<typeof vi.fn>;
  };
};

let close: ReturnType<typeof vi.fn<() => Promise<void>>>;

afterEach(() => {
  if (previousSummary === undefined) {
    delete process.env.GITHUB_STEP_SUMMARY;
  } else {
    process.env.GITHUB_STEP_SUMMARY = previousSummary;
  }
  if (previousMcpKey === undefined) {
    delete process.env.YOUR_MCP_KEY;
  } else {
    process.env.YOUR_MCP_KEY = previousMcpKey;
  }
  if (previousJudgeModel === undefined) {
    delete process.env.MCP_EVAL_JUDGE_MODEL;
  } else {
    process.env.MCP_EVAL_JUDGE_MODEL = previousJudgeModel;
  }
});

beforeEach(() => {
  close = vi.fn(async () => undefined);
  vi.mocked(runEvals).mockReset();
  vi.mocked(runEvals).mockResolvedValue(evalRunResult);
  vi.mocked(toolsFromMcp).mockReset();
  vi.mocked(toolsFromMcp).mockResolvedValue({ tools: { ping: {} } as never, close });
  vi.mocked(assertEvalResult).mockReset();
  vi.mocked(writeGitHubSummary).mockReset();
});

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'mcp-eval-gateway-cli-'));
}

function writeProjectEval(
  rootDir: string,
  dir: string,
  filename: string,
  contents: string,
): void {
  const targetDir = join(rootDir, dir);
  mkdirSync(targetDir, { recursive: true });
  writeFileSync(join(targetDir, filename), contents);
}

function writeEvalFile(rootDir: string, filename: string, contents: string): void {
  writeProjectEval(rootDir, 'eval', filename, contents);
}

const envAwareConfig = `export default {
  model: 'gateway/x',
  mcp: {
    url: 'http://localhost/mcp',
    headers: { Authorization: \`Bearer \${process.env.YOUR_MCP_KEY}\` },
  },
};
`;

const arrayModelConfig = `export default { model: ['gateway/a', 'gateway/b'], mcp: { url: 'http://localhost/mcp' } };
`;

function writeTasks(rootDir: string, yaml = pingTasksYaml): void {
  writeEvalFile(rootDir, 'tasks.yaml', yaml);
}

describe('runEvalProject', () => {
  it('rejects when eval/config is missing', async () => {
    const rootDir = tempRoot();
    mkdirSync(join(rootDir, 'eval'), { recursive: true });

    const error = await runEvalProject(rootDir).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain('eval/config');
    expect(message).toMatch(/ts/);
    expect(message).toMatch(/js|mjs/);
  });

  it('rejects when eval/tasks.yaml is missing', async () => {
    const rootDir = tempRoot();
    writeEvalFile(
      rootDir,
      'config.mjs',
      `export default { model: 'gateway/x', mcp: { url: 'http://localhost/mcp' } };\n`,
    );

    const error = await runEvalProject(rootDir).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('eval/tasks.yaml');
  });

  it('loads mjs config and yaml tasks, then closes the MCP session', async () => {
    const rootDir = tempRoot();
    writeEvalFile(
      rootDir,
      'config.mjs',
      `export default {
  model: 'gateway/x',
  threshold: 0.8,
  mcp: {
    url: 'http://example.com/mcp',
    headers: { Authorization: 'Bearer t' },
  },
};
`,
    );
    writeTasks(rootDir);

    await runEvalProject(rootDir);

    expect(toolsFromMcp).toHaveBeenCalledWith({
      url: 'http://example.com/mcp',
      headers: { Authorization: 'Bearer t' },
    });
    expect(runEvals).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gateway/x',
        tasks: [{ name: 'ping', prompt: 'hi', expected: 'pong', required: false }],
      }),
    );
    expect(assertEvalResult).toHaveBeenCalledWith(evalRunResult, { threshold: 0.8 });
    expect(writeGitHubSummary).toHaveBeenCalledWith(evalRunResult);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('passes required: true from yaml into runEvals', async () => {
    const rootDir = tempRoot();
    writeEvalFile(
      rootDir,
      'config.mjs',
      `export default { model: 'gateway/x', mcp: { url: 'http://localhost/mcp' } };\n`,
    );
    writeTasks(
      rootDir,
      `- name: ping
  prompt: hi
  expected: pong
  required: true
`,
    );

    await runEvalProject(rootDir);

    expect(vi.mocked(runEvals).mock.calls[0]?.[0]?.tasks[0]?.required).toBe(true);
  });

  it('prefers eval/config.ts over eval/config.js', async () => {
    const rootDir = tempRoot();
    writeEvalFile(
      rootDir,
      'config.js',
      `export default { model: 'gateway/from-js', mcp: { url: 'http://localhost/mcp' } };\n`,
    );
    writeEvalFile(
      rootDir,
      'config.ts',
      `export default { model: 'gateway/from-ts', mcp: { url: 'http://localhost/mcp' } };\n`,
    );
    writeTasks(rootDir);

    await runEvalProject(rootDir);

    expect(vi.mocked(runEvals).mock.calls[0]?.[0]?.model).toBe('gateway/from-ts');
  });

  it('loads a consumer-style ESM eval/config.js', async () => {
    const rootDir = tempRoot();
    writeFileSync(join(rootDir, 'package.json'), JSON.stringify({ type: 'module' }));
    writeEvalFile(
      rootDir,
      'config.js',
      `export default { model: 'gateway/js', mcp: { url: 'http://localhost/mcp' } };\n`,
    );
    writeTasks(rootDir);

    await runEvalProject(rootDir);

    expect(vi.mocked(runEvals).mock.calls[0]?.[0]?.model).toBe('gateway/js');
  });

  it('calls close when runEvals rejects', async () => {
    const rootDir = tempRoot();
    writeEvalFile(
      rootDir,
      'config.mjs',
      `export default { model: 'gateway/x', mcp: { url: 'http://localhost/mcp' } };\n`,
    );
    writeTasks(rootDir);
    vi.mocked(runEvals).mockRejectedValue(new Error('model failed'));

    await expect(runEvalProject(rootDir)).rejects.toThrow(/model failed/);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('omits threshold from assertEvalResult when the config has none', async () => {
    const rootDir = tempRoot();
    writeEvalFile(
      rootDir,
      'config.mjs',
      `export default { model: 'gateway/x', mcp: { url: 'http://localhost/mcp' } };\n`,
    );
    writeTasks(rootDir);

    await runEvalProject(rootDir);

    const options = vi.mocked(assertEvalResult).mock.calls[0]?.[1];
    expect(options === undefined || !('threshold' in options)).toBe(true);
  });

  it('rejects a yaml item that is missing expected', async () => {
    const rootDir = tempRoot();
    writeEvalFile(
      rootDir,
      'config.mjs',
      `export default { model: 'gateway/x', mcp: { url: 'http://localhost/mcp' } };\n`,
    );
    writeTasks(
      rootDir,
      `- name: ping
  prompt: hi
`,
    );

    const error = await runEvalProject(rootDir).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('expected');
    expect((error as Error).message).toContain('judge');
  });

  it('loads .env from rootDir into config mcp headers', async () => {
    delete process.env.YOUR_MCP_KEY;
    const rootDir = tempRoot();
    writeFileSync(join(rootDir, '.env'), 'YOUR_MCP_KEY=from-dotenv\n');
    writeEvalFile(rootDir, 'config.mjs', envAwareConfig);
    writeTasks(rootDir);

    await runEvalProject(rootDir);

    expect(vi.mocked(toolsFromMcp).mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        headers: { Authorization: 'Bearer from-dotenv' },
      }),
    );
  });

  it('keeps an existing process.env value over .env', async () => {
    process.env.YOUR_MCP_KEY = 'from-process';
    const rootDir = tempRoot();
    writeFileSync(join(rootDir, '.env'), 'YOUR_MCP_KEY=from-file\n');
    writeEvalFile(rootDir, 'config.mjs', envAwareConfig);
    writeTasks(rootDir);

    await runEvalProject(rootDir);

    expect(vi.mocked(toolsFromMcp).mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        headers: { Authorization: 'Bearer from-process' },
      }),
    );
  });

  it('loads --env-file instead of .env', async () => {
    delete process.env.YOUR_MCP_KEY;
    const rootDir = tempRoot();
    writeFileSync(join(rootDir, '.env'), 'YOUR_MCP_KEY=from-file\n');
    writeFileSync(join(rootDir, '.env.local'), 'YOUR_MCP_KEY=from-local\n');
    writeEvalFile(rootDir, 'config.mjs', envAwareConfig);
    writeTasks(rootDir);

    await runEvalProject(rootDir, { envFile: '.env.local' });

    expect(vi.mocked(toolsFromMcp).mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        headers: { Authorization: 'Bearer from-local' },
      }),
    );
  });

  it('rejects when --env-file is missing', async () => {
    const rootDir = tempRoot();
    writeEvalFile(
      rootDir,
      'config.mjs',
      `export default { model: 'gateway/x', mcp: { url: 'http://localhost/mcp' } };\n`,
    );
    writeTasks(rootDir);

    const error = await runEvalProject(rootDir, { envFile: 'missing.env' }).catch(
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('missing.env');
  });

  it('loads config and tasks from --dir', async () => {
    const rootDir = tempRoot();
    writeProjectEval(
      rootDir,
      'src/eval',
      'config.mjs',
      `export default { model: 'gateway/from-dir', mcp: { url: 'http://localhost/mcp' } };\n`,
    );
    writeProjectEval(rootDir, 'src/eval', 'tasks.yaml', pingTasksYaml);

    await runEvalProject(rootDir, { dir: 'src/eval' });

    expect(runEvals).toHaveBeenCalled();
    expect(vi.mocked(runEvals).mock.calls[0]?.[0]?.model).toBe('gateway/from-dir');
  });

  it('rejects when config is missing under --dir', async () => {
    const rootDir = tempRoot();
    mkdirSync(join(rootDir, 'src/eval'), { recursive: true });

    const error = await runEvalProject(rootDir, { dir: 'src/eval' }).catch(
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain('src/eval');
    expect(message).toContain('config');
  });

  it('runs every model in a config array', async () => {
    const rootDir = tempRoot();
    writeEvalFile(rootDir, 'config.mjs', arrayModelConfig);
    writeTasks(rootDir);

    await runEvalProject(rootDir);

    expect(toolsFromMcp).toHaveBeenCalledTimes(1);
    expect(runEvals).toHaveBeenCalledTimes(2);
    expect(vi.mocked(runEvals).mock.calls[0]?.[0]?.model).toBe('gateway/a');
    expect(vi.mocked(runEvals).mock.calls[1]?.[0]?.model).toBe('gateway/b');
    expect(writeGitHubSummary).toHaveBeenCalledTimes(2);
    expect(writeGitHubSummary).toHaveBeenNthCalledWith(1, evalRunResult);
    expect(writeGitHubSummary).toHaveBeenNthCalledWith(2, evalRunResult);
    expect(assertEvalResult).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('runs only the --model when the config lists several', async () => {
    const rootDir = tempRoot();
    writeEvalFile(rootDir, 'config.mjs', arrayModelConfig);
    writeTasks(rootDir);

    await runEvalProject(rootDir, { model: 'gateway/a' });

    expect(runEvals).toHaveBeenCalledTimes(1);
    expect(vi.mocked(runEvals).mock.calls[0]?.[0]?.model).toBe('gateway/a');
  });

  it('runs --model even when it is not in the config list', async () => {
    const rootDir = tempRoot();
    writeEvalFile(
      rootDir,
      'config.mjs',
      `export default { model: 'gateway/x', mcp: { url: 'http://localhost/mcp' } };\n`,
    );
    writeTasks(rootDir);

    await runEvalProject(rootDir, { model: 'gateway/y' });

    expect(runEvals).toHaveBeenCalledTimes(1);
    expect(vi.mocked(runEvals).mock.calls[0]?.[0]?.model).toBe('gateway/y');
  });

  it('closes the session after a later model fails', async () => {
    const rootDir = tempRoot();
    writeEvalFile(rootDir, 'config.mjs', arrayModelConfig);
    writeTasks(rootDir);
    vi.mocked(runEvals)
      .mockResolvedValueOnce(evalRunResult)
      .mockRejectedValueOnce(new Error('model failed'));

    await expect(runEvalProject(rootDir)).rejects.toThrow(/model failed/);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('loads a yaml task with judge', async () => {
    const rootDir = tempRoot();
    writeEvalFile(
      rootDir,
      'config.mjs',
      `export default { model: 'gateway/x', mcp: { url: 'http://localhost/mcp' } };\n`,
    );
    writeTasks(
      rootDir,
      `- name: onboard
  prompt: set up a project
  judge: a space is created
`,
    );

    await runEvalProject(rootDir);

    const task = vi.mocked(runEvals).mock.calls[0]?.[0]?.tasks[0];
    expect(task?.judge).toBe('a space is created');
    expect(task?.expected === undefined || task?.expected === null).toBe(true);
  });

  it('rejects a yaml item that has both expected and judge', async () => {
    const rootDir = tempRoot();
    writeEvalFile(
      rootDir,
      'config.mjs',
      `export default { model: 'gateway/x', mcp: { url: 'http://localhost/mcp' } };\n`,
    );
    writeTasks(
      rootDir,
      `- name: ping
  prompt: hi
  expected: pong
  judge: the agent replies pong
`,
    );

    const error = await runEvalProject(rootDir).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/exactly one/);
  });

  it('passes config judgeModel to runEvals', async () => {
    delete process.env.MCP_EVAL_JUDGE_MODEL;
    const rootDir = tempRoot();
    writeEvalFile(
      rootDir,
      'config.mjs',
      `export default { model: 'gateway/x', judgeModel: 'gateway/judge-from-config', mcp: { url: 'http://localhost/mcp' } };
`,
    );
    writeTasks(rootDir);

    await runEvalProject(rootDir);

    expect(runEvals).toHaveBeenCalledWith(
      expect.objectContaining({
        judgeModel: 'gateway/judge-from-config',
      }),
    );
  });

  it('env MCP_EVAL_JUDGE_MODEL beats config judgeModel', async () => {
    process.env.MCP_EVAL_JUDGE_MODEL = 'gateway/judge-from-env';
    const rootDir = tempRoot();
    writeEvalFile(
      rootDir,
      'config.mjs',
      `export default { model: 'gateway/x', judgeModel: 'gateway/judge-from-config', mcp: { url: 'http://localhost/mcp' } };
`,
    );
    writeTasks(rootDir);

    await runEvalProject(rootDir);

    expect(runEvals).toHaveBeenCalledWith(
      expect.objectContaining({
        judgeModel: 'gateway/judge-from-env',
      }),
    );
  });

  it('options.judgeModel beats env and config', async () => {
    process.env.MCP_EVAL_JUDGE_MODEL = 'gateway/judge-from-env';
    const rootDir = tempRoot();
    writeEvalFile(
      rootDir,
      'config.mjs',
      `export default { model: 'gateway/x', judgeModel: 'gateway/judge-from-config', mcp: { url: 'http://localhost/mcp' } };
`,
    );
    writeTasks(rootDir);

    await runEvalProject(rootDir, {
      judgeModel: 'gateway/judge-from-cli',
    });

    expect(runEvals).toHaveBeenCalledWith(
      expect.objectContaining({
        judgeModel: 'gateway/judge-from-cli',
      }),
    );
  });

  it('filters tasks by --task substring before calling runEvals', async () => {
    const rootDir = tempRoot();
    writeEvalFile(rootDir, 'config.mjs', defaultConfig);
    writeTasks(rootDir, multiTasksYaml);

    await runEvalProject(rootDir, { task: ['url-paste'] } as RunEvalProjectFilterOptions);

    const evalTasks = vi.mocked(runEvals).mock.calls[0]?.[0]?.tasks;
    expect(evalTasks?.map((item) => item.name)).toEqual([
      'url-paste-space',
      'url-paste-task-panel',
    ]);
  });

  it('limits to the first yaml task when only --limit is set', async () => {
    const rootDir = tempRoot();
    writeEvalFile(rootDir, 'config.mjs', defaultConfig);
    writeTasks(rootDir, multiTasksYaml);

    await runEvalProject(rootDir, { limit: 1 } as RunEvalProjectFilterOptions);

    const evalTasks = vi.mocked(runEvals).mock.calls[0]?.[0]?.tasks;
    expect(evalTasks?.map((item) => item.name)).toEqual(['ping']);
  });

  it('applies --limit after the --task filter', async () => {
    const rootDir = tempRoot();
    writeEvalFile(rootDir, 'config.mjs', defaultConfig);
    writeTasks(rootDir, multiTasksYaml);

    await runEvalProject(rootDir, {
      task: ['url-paste'],
      limit: 1,
    } as RunEvalProjectFilterOptions);

    const evalTasks = vi.mocked(runEvals).mock.calls[0]?.[0]?.tasks;
    expect(evalTasks?.map((item) => item.name)).toEqual(['url-paste-space']);
  });

  it('rejects an unmatched --task before connecting to MCP', async () => {
    const rootDir = tempRoot();
    writeEvalFile(rootDir, 'config.mjs', defaultConfig);
    writeTasks(rootDir, multiTasksYaml);

    await expect(
      runEvalProject(rootDir, { task: ['nope'] } as RunEvalProjectFilterOptions),
    ).rejects.toThrow();
    expect(toolsFromMcp).not.toHaveBeenCalled();
  });

  it('emits onPhase with MCP before the session connects', async () => {
    const rootDir = tempRoot();
    writeEvalFile(rootDir, 'config.mjs', defaultConfig);
    writeTasks(rootDir, multiTasksYaml);

    let releaseConnect!: () => void;
    const connectGate = new Promise<void>((resolve) => {
      releaseConnect = resolve;
    });
    vi.mocked(toolsFromMcp).mockImplementation(async () => {
      await connectGate;
      return { tools: { ping: {} } as never, close };
    });

    const reporter = {
      onRunStart: vi.fn(),
      onPhase: vi.fn(),
      onTaskStart: vi.fn(),
      onTaskEnd: vi.fn(),
      onRunEnd: vi.fn(),
    };

    const runPromise = runEvalProject(rootDir, { reporter } as RunEvalProjectFilterOptions);

    try {
      await vi.waitFor(() => {
        expect(reporter.onPhase).toHaveBeenCalledWith(expect.stringMatching(/MCP/i));
      });
      expect(reporter.onRunStart).toHaveBeenCalled();
      expect(reporter.onRunStart.mock.calls[0]?.[0]).toEqual(
        expect.objectContaining({ tasks: 3 }),
      );
    } finally {
      releaseConnect();
      await runPromise;
    }
  });

  it('forwards reporter task callbacks into runEvals', async () => {
    const rootDir = tempRoot();
    writeEvalFile(rootDir, 'config.mjs', defaultConfig);
    writeTasks(rootDir, multiTasksYaml);

    const reporter = {
      onRunStart: vi.fn(),
      onPhase: vi.fn(),
      onTaskStart: vi.fn(),
      onTaskEnd: vi.fn(),
      onRunEnd: vi.fn(),
    };

    await runEvalProject(rootDir, { reporter } as RunEvalProjectFilterOptions);

    const opts = vi.mocked(runEvals).mock.calls[0]?.[0] as RunEvalCallbacks | undefined;
    expect(typeof opts?.onTaskStart).toBe('function');
    expect(typeof opts?.onTaskEnd).toBe('function');
  });

  it('does not pass task callbacks into runEvals without a reporter', async () => {
    const rootDir = tempRoot();
    writeEvalFile(rootDir, 'config.mjs', defaultConfig);
    writeTasks(rootDir);

    await runEvalProject(rootDir);

    const opts = vi.mocked(runEvals).mock.calls[0]?.[0] as RunEvalCallbacks | undefined;
    expect(opts?.onTaskStart).toBeUndefined();
  });
});

