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

let close: ReturnType<typeof vi.fn<() => Promise<void>>>;

afterEach(() => {
  if (previousSummary === undefined) {
    delete process.env.GITHUB_STEP_SUMMARY;
  } else {
    process.env.GITHUB_STEP_SUMMARY = previousSummary;
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

function writeEvalFile(rootDir: string, filename: string, contents: string): void {
  const evalDir = join(rootDir, 'eval');
  mkdirSync(evalDir, { recursive: true });
  writeFileSync(join(evalDir, filename), contents);
}

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
  });
});
