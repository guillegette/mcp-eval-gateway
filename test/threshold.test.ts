import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertEvalResult,
  writeGitHubSummary,
  type EvalRunResult,
  type TaskResult,
} from '../src/index';

const previousSummary = process.env.GITHUB_STEP_SUMMARY;

afterEach(() => {
  if (previousSummary === undefined) {
    delete process.env.GITHUB_STEP_SUMMARY;
  } else {
    process.env.GITHUB_STEP_SUMMARY = previousSummary;
  }
});

function task(overrides: Partial<TaskResult> & Pick<TaskResult, 'name'>): TaskResult {
  const passed = overrides.passed ?? true;
  return {
    prompt: overrides.name,
    expected: 'ok',
    actual: passed ? 'ok' : 'no',
    score: passed ? 1 : 0,
    passed,
    required: false,
    durationMs: 1,
    toolMetrics: {},
    numToolCalls: 0,
    summary: null,
    feedback: null,
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

describe('assertEvalResult', () => {
  it('does not throw when accuracy meets the threshold', () => {
    const result = evalResult([
      task({ name: 'pass-1' }),
      task({ name: 'pass-2' }),
      task({ name: 'pass-3' }),
      task({ name: 'pass-4' }),
      task({ name: 'fail-1', passed: false }),
    ]);
    expect(result.accuracy).toBe(0.8);
    expect(() => assertEvalResult(result, { threshold: 0.8 })).not.toThrow();
  });

  it('throws below threshold and names the failed task', () => {
    const result = evalResult([
      task({ name: 'pass' }),
      task({ name: 'find-overdue', passed: false }),
    ]);
    expect(result.accuracy).toBe(0.5);
    expect(() => assertEvalResult(result, { threshold: 0.8 })).toThrow(Error);
    expect(() => assertEvalResult(result, { threshold: 0.8 })).toThrow(/find-overdue/);
  });

  it('throws when a required task fails even if accuracy is above threshold', () => {
    const result = evalResult([
      task({ name: 'pass-1' }),
      task({ name: 'pass-2' }),
      task({ name: 'pass-3' }),
      task({ name: 'pass-4' }),
      task({ name: 'smoke-create', passed: false, required: true }),
    ]);
    expect(result.accuracy).toBe(0.8);
    expect(() => assertEvalResult(result, { threshold: 0.5 })).toThrow(Error);
    expect(() => assertEvalResult(result, { threshold: 0.5 })).toThrow(/smoke-create/);
  });

  it('does not throw with no threshold and no required failures', () => {
    const result = evalResult([task({ name: 'always-wrong', passed: false })]);
    expect(result.accuracy).toBe(0);
    expect(() => assertEvalResult(result)).not.toThrow();
  });

  it('throws when no tasks ran, even without a threshold', () => {
    expect(() => assertEvalResult(evalResult([]))).toThrow(/No tasks ran/);
    expect(() => assertEvalResult(evalResult([]), { threshold: 0.8 })).toThrow(/No tasks ran/);
  });
});

describe('writeGitHubSummary', () => {
  it('appends the report when GITHUB_STEP_SUMMARY is set and is a no-op otherwise', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcp-eval-gateway-'));
    const summaryPath = join(dir, 'summary.md');
    writeFileSync(summaryPath, 'existing\n');
    const result = evalResult([task({ name: 'demo' })], '## Accuracy\n1/1');

    process.env.GITHUB_STEP_SUMMARY = summaryPath;
    expect(writeGitHubSummary(result)).toBe(true);
    const afterWrite = readFileSync(summaryPath, 'utf8');
    expect(afterWrite).toContain('existing');
    expect(afterWrite).toContain('## Accuracy\n1/1');

    delete process.env.GITHUB_STEP_SUMMARY;
    expect(writeGitHubSummary(result)).toBe(false);
    expect(readFileSync(summaryPath, 'utf8')).toBe(afterWrite);
  });
});
