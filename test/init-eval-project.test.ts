import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { initEvalProject } from '../src/index';

const INIT_CONFIG = `export default {
  model: 'gateway/anthropic/claude-sonnet-4-6',
  threshold: 0.8,
  mcp: {
    url: 'http://localhost/mcp',
    headers: { Authorization: \`Bearer \${process.env.MCP_API_KEY}\` },
  },
};
`;

const INIT_TASKS = `- name: ping
  prompt: Call the ping tool and return its text
  expected: pong
  required: true
`;

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'mcp-eval-gateway-init-'));
}

function writeExisting(rootDir: string, dir: string, filename: string, contents: string): void {
  const targetDir = join(rootDir, dir);
  mkdirSync(targetDir, { recursive: true });
  writeFileSync(join(targetDir, filename), contents);
}

describe('initEvalProject', () => {
  it('writes eval/config.ts and eval/tasks.yaml', () => {
    const rootDir = tempRoot();

    initEvalProject(rootDir);

    expect(readFileSync(join(rootDir, 'eval/config.ts'), 'utf8')).toBe(INIT_CONFIG);
    expect(readFileSync(join(rootDir, 'eval/tasks.yaml'), 'utf8')).toBe(INIT_TASKS);
  });

  it('creates the eval directory', () => {
    const rootDir = tempRoot();

    initEvalProject(rootDir);

    expect(statSync(join(rootDir, 'eval')).isDirectory()).toBe(true);
    expect(existsSync(join(rootDir, 'eval/config.ts'))).toBe(true);
    expect(existsSync(join(rootDir, 'eval/tasks.yaml'))).toBe(true);
  });

  it('honors --dir', () => {
    const rootDir = tempRoot();

    initEvalProject(rootDir, { dir: 'src/eval' });

    expect(readFileSync(join(rootDir, 'src/eval/config.ts'), 'utf8')).toBe(INIT_CONFIG);
    expect(readFileSync(join(rootDir, 'src/eval/tasks.yaml'), 'utf8')).toBe(INIT_TASKS);
    expect(existsSync(join(rootDir, 'eval/config.ts'))).toBe(false);
  });

  it('rejects when eval/config.ts exists', () => {
    const rootDir = tempRoot();
    writeExisting(rootDir, 'eval', 'config.ts', 'keep\n');

    let thrown: unknown;
    try {
      initEvalProject(rootDir);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain('eval/config.ts');
    expect((thrown as Error).message).toContain('already exists');
    expect(readFileSync(join(rootDir, 'eval/config.ts'), 'utf8')).toBe('keep\n');
    expect(existsSync(join(rootDir, 'eval/tasks.yaml'))).toBe(false);
  });

  it('rejects when eval/tasks.yaml exists', () => {
    const rootDir = tempRoot();
    writeExisting(rootDir, 'eval', 'tasks.yaml', 'keep\n');

    let thrown: unknown;
    try {
      initEvalProject(rootDir);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain('eval/tasks.yaml');
    expect((thrown as Error).message).toContain('already exists');
    expect(existsSync(join(rootDir, 'eval/config.ts'))).toBe(false);
    expect(readFileSync(join(rootDir, 'eval/tasks.yaml'), 'utf8')).toBe('keep\n');
  });

  it('rejects when another config extension exists', () => {
    const rootDir = tempRoot();
    writeExisting(rootDir, 'eval', 'config.mjs', 'keep\n');

    let thrown: unknown;
    try {
      initEvalProject(rootDir);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain('eval/config.mjs');
    expect((thrown as Error).message).toContain('already exists');
    expect(existsSync(join(rootDir, 'eval/config.ts'))).toBe(false);
  });

  it('rejects under --dir without writing the sibling', () => {
    const rootDir = tempRoot();
    writeExisting(rootDir, 'src/eval', 'config.ts', 'keep\n');

    let thrown: unknown;
    try {
      initEvalProject(rootDir, { dir: 'src/eval' });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain('src/eval/config.ts');
    expect((thrown as Error).message).toContain('already exists');
    expect(existsSync(join(rootDir, 'src/eval/tasks.yaml'))).toBe(false);
  });
});
