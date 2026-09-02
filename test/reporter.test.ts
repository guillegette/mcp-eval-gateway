import { describe, expect, it, vi } from 'vitest';
import {
  createReporter,
  formatPhase,
  formatRunFooter,
  formatRunHeader,
  formatTaskEnd,
  formatTaskStart,
  formatTranscript,
} from '../src/reporter';
import type { EvalRunResult, TaskResult } from '../src/types';

const sampleTranscript = [
  {
    tool: 'create_tasks',
    input: { title: 'Launch' },
    output: { error: 'validation failed' },
  },
];

function task(overrides: Partial<TaskResult> & Pick<TaskResult, 'name'>): TaskResult {
  const passed = overrides.passed ?? true;
  return {
    prompt: overrides.name,
    expected: 'ok',
    judge: null,
    judgeReason: null,
    actual: passed ? 'ok' : 'no',
    score: passed ? 1 : 0,
    passed,
    required: false,
    durationMs: 1,
    toolMetrics: {},
    numToolCalls: 0,
    summary: null,
    feedback: null,
    transcript: [],
    ...overrides,
  };
}

function evalResult(results: TaskResult[], report = 'eval report'): EvalRunResult {
  const correct = results.filter((item) => item.passed).length;
  return {
    total: results.length,
    correct,
    accuracy: results.length === 0 ? 0 : correct / results.length,
    results,
    report,
  };
}

function expectPlain(line: string): void {
  expect(line).not.toContain('#');
  expect(line).not.toContain('**');
}

describe('formatRunHeader', () => {
  it('includes model, judge, mcp url, and task count', () => {
    const line = formatRunHeader({
      model: 'gateway/x',
      judge: 'gateway/j',
      mcp: 'http://localhost/mcp',
      tasks: 22,
    });
    expectPlain(line);
    expect(line).toContain('gateway/x');
    expect(line).toContain('gateway/j');
    expect(line).toContain('http://localhost/mcp');
    expect(line).toContain('22');
  });
});

describe('formatPhase', () => {
  it('includes the phase message', () => {
    const line = formatPhase('Connecting to MCP');
    expectPlain(line);
    expect(line).toContain('Connecting to MCP');
  });
});

describe('formatTaskStart', () => {
  it('uses a 1-based display index and the RUN token', () => {
    const line = formatTaskStart({ index: 0, total: 22, name: 'campaign-setup' });
    expectPlain(line);
    expect(line).toContain('RUN');
    expect(line).toContain('[1/22]');
    expect(line).toContain('campaign-setup');
  });
});

describe('formatTaskEnd', () => {
  it('summarizes a passing expected-match task without failure details', () => {
    const line = formatTaskEnd(
      task({
        name: 'ping',
        passed: true,
        judge: null,
        durationMs: 1200,
        numToolCalls: 1,
      }),
      { index: 0, total: 2 },
    );
    expectPlain(line);
    expect(line).toContain('PASS');
    expect(line).toContain('[1/2]');
    expect(line).toContain('ping');
    expect(line).toContain('1.20s');
    expect(line).toContain('1 tool');
    expect(line).not.toContain('1 tools');
    expect(line).not.toContain('expected');
    expect(line).not.toContain('actual');
  });

  it('includes expected and actual on a failing expected-match task', () => {
    const line = formatTaskEnd(
      task({
        name: 'ping',
        passed: false,
        expected: 'pong',
        actual: 'nope',
        judge: null,
      }),
      { index: 0, total: 1 },
    );
    expect(line).toContain('FAIL');
    expect(line).toContain('ping');
    expect(line).toContain('pong');
    expect(line).toContain('nope');
  });

  it('marks a passing judge task with the judge token and plural tools', () => {
    const line = formatTaskEnd(
      task({
        name: 'onboard',
        passed: true,
        expected: null,
        judge: 'a space is created',
        numToolCalls: 4,
      }),
      { index: 0, total: 1 },
    );
    expect(line).toContain('PASS');
    expect(line).toContain('judge');
    expect(line).toContain('4 tools');
  });

  it('includes the rubric and reason on a failing judge task', () => {
    const line = formatTaskEnd(
      task({
        name: 'onboard',
        passed: false,
        expected: null,
        judge: 'a space is created',
        judgeReason: 'no create-space call',
      }),
      { index: 0, total: 1 },
    );
    expect(line).toContain('FAIL');
    expect(line).toContain('a space is created');
    expect(line).toContain('no create-space call');
  });
});

describe('formatRunFooter', () => {
  it('summarizes passed, failed, total, accuracy, threshold, and elapsed 3m12s', () => {
    const passing = Array.from({ length: 20 }, (_, index) => task({ name: `pass-${index}` }));
    const result = evalResult([
      ...passing,
      task({ name: 'fail-1', passed: false }),
      task({ name: 'fail-2', passed: false }),
    ]);
    expect(result.total).toBe(22);
    expect(result.correct).toBe(20);
    expect(result.accuracy).toBe(20 / 22);

    const line = formatRunFooter(result, { threshold: 0.8, durationMs: 192000 });
    expectPlain(line);
    expect(line).toContain('20');
    expect(line).toMatch(/\b2\b/);
    expect(line).toContain('22');
    expect(line).toContain('90.9');
    expect(line).toMatch(/80%|0\.8/);
    expect(line).toContain('3m12s');
  });
});

describe('formatTranscript', () => {
  it('describes an empty transcript as no tool calls', () => {
    const line = formatTranscript([]);
    expectPlain(line);
    expect(line).toContain('no tool');
  });

  it('includes tool name, input, and output', () => {
    const line = formatTranscript(sampleTranscript);
    expectPlain(line);
    expect(line).toContain('create_tasks');
    expect(line).toContain('Launch');
    expect(line).toContain('validation failed');
  });
});

describe('createReporter', () => {
  it('writes newline-terminated progress lines for each event', () => {
    const write = vi.fn();
    const reporter = createReporter(write);
    const passing = task({ name: 'ping', passed: true });
    const result = evalResult([passing]);

    reporter.onRunStart({ model: 'gateway/x', mcp: 'http://localhost/mcp', tasks: 1 });
    expect(write).toHaveBeenCalled();
    const header = write.mock.calls[0]?.[0] as string;
    expect(header).toContain('gateway/x');
    expect(header.endsWith('\n')).toBe(true);

    write.mockClear();
    reporter.onTaskStart({ index: 0, total: 1, name: 'ping' });
    expect(String(write.mock.calls[0]?.[0])).toContain('RUN');
    expect(String(write.mock.calls[0]?.[0])).toContain('ping');

    write.mockClear();
    reporter.onTaskEnd(passing, { index: 0, total: 1 });
    expect(String(write.mock.calls[0]?.[0])).toContain('PASS');

    write.mockClear();
    reporter.onPhase('Connecting to MCP');
    expect(String(write.mock.calls[0]?.[0])).toContain('Connecting to MCP');

    write.mockClear();
    reporter.onRunEnd(result, { durationMs: 1000 });
    const footer = String(write.mock.calls[0]?.[0]);
    expect(footer.includes('passed') || footer.includes(String(result.correct))).toBe(true);
  });

  it('does not dump the transcript on onTaskEnd by default', () => {
    const write = vi.fn();
    const reporter = createReporter(write);
    reporter.onTaskEnd(
      task({
        name: 'ping',
        passed: true,
        transcript: sampleTranscript,
      }),
      { index: 0, total: 1 },
    );

    const written = write.mock.calls.map((call) => String(call[0])).join('');
    expect(written).toContain('PASS');
    expect(written).not.toContain('create_tasks');
    expect(written).not.toContain('Launch');
    expect(written).not.toContain('validation failed');
  });

  it('dumps the transcript after PASS when verbose', () => {
    const write = vi.fn();
    const reporter = createReporter(write, { verbose: true });
    reporter.onTaskEnd(
      task({
        name: 'ping',
        passed: true,
        transcript: sampleTranscript,
      }),
      { index: 0, total: 1 },
    );

    const chunks = write.mock.calls.map((call) => String(call[0]));
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.endsWith('\n')).toBe(true);
    }

    const written = chunks.join('');
    expect(written).toContain('PASS');
    expect(written).toContain('create_tasks');
    expect(written).toContain('Launch');
    expect(written).toContain('validation failed');
  });
});
