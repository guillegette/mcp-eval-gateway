import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseEvalCli } from '../src/parse-cli';

describe('parseEvalCli', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('collects repeated --task flags and treats the command as run', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const parsed = parseEvalCli(['--task', 'ping', '--task', 'whoami']);
    expect(exit).not.toHaveBeenCalled();
    expect(parsed.command).toBe('run');
    expect(parsed.task).toEqual(['ping', 'whoami']);
    expect(parsed.verbose).toBeUndefined();
  });

  it('parses --limit as a number', () => {
    const parsed = parseEvalCli(['--limit', '3']);
    expect(parsed.limit).toBe(3);
    expect(parsed.verbose).toBeUndefined();
  });

  it('parses --task and --limit together', () => {
    const parsed = parseEvalCli(['--task', 'url-paste', '--limit', '1']);
    expect(parsed.task).toEqual(['url-paste']);
    expect(parsed.limit).toBe(1);
    expect(parsed.verbose).toBeUndefined();
  });

  it('parses --verbose as true and treats the command as run', () => {
    const parsed = parseEvalCli(['--verbose']);
    expect(parsed.command).toBe('run');
    expect(parsed.verbose).toBe(true);
  });

  it('parses --task and --verbose together', () => {
    const parsed = parseEvalCli(['--task', 'ping', '--verbose']);
    expect(parsed.task).toEqual(['ping']);
    expect(parsed.verbose).toBe(true);
  });

  it.each([
    ['0', ['--limit', '0']],
    ['-1', ['--limit', '-1']],
    ['abc', ['--limit', 'abc']],
  ])('throws on --limit %s without calling process.exit', (_label, argv) => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    expect(() => parseEvalCli(argv)).toThrow(Error);
    expect(exit).not.toHaveBeenCalled();
  });

  it('parses the init command and --dir', () => {
    const parsed = parseEvalCli(['init', '--dir', 'src/eval']);
    expect(parsed.command).toBe('init');
    expect(parsed.dir).toBe('src/eval');
    expect(parsed.verbose).toBeUndefined();
  });

  it('maps flag names to camelCase fields', () => {
    const parsed = parseEvalCli([
      '--dir',
      'eval',
      '--model',
      'gateway/x',
      '--judge-model',
      'gateway/j',
      '--env-file',
      '.env.local',
    ]);
    expect(parsed.dir).toBe('eval');
    expect(parsed.model).toBe('gateway/x');
    expect(parsed.judgeModel).toBe('gateway/j');
    expect(parsed.envFile).toBe('.env.local');
    expect(parsed.verbose).toBeUndefined();
  });

  it('returns unknown for an unrecognized positional', () => {
    const parsed = parseEvalCli(['wat']);
    expect(parsed).toEqual({ command: 'unknown', positional: 'wat' });
    expect(parsed.verbose).toBeUndefined();
  });
});
