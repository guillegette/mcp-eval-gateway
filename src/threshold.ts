import { appendFileSync } from 'node:fs';
import type { EvalRunResult, TaskResult } from './types';

function describeFailure(task: TaskResult): string {
  return `${task.name} (expected "${task.expected}", got "${task.actual}")`;
}

export function assertEvalResult(
  result: EvalRunResult,
  options?: { threshold?: number },
): void {
  if (result.total === 0 || result.results.length === 0) {
    throw new Error('No tasks ran');
  }

  const requiredFailures = result.results.filter((task) => task.required && !task.passed);
  if (requiredFailures.length > 0) {
    const details = requiredFailures
      .map((task) => `Required task failed: ${describeFailure(task)}`)
      .join('\n');
    throw new Error(details);
  }

  const threshold = options?.threshold;
  if (typeof threshold === 'number' && result.accuracy < threshold) {
    const failed = result.results.filter((task) => !task.passed);
    const names = failed.map(describeFailure).join('; ');
    throw new Error(
      `Accuracy ${result.accuracy} is below threshold ${threshold}. Failed tasks: ${names}`,
    );
  }
}

export function writeGitHubSummary(result: EvalRunResult): boolean {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) {
    return false;
  }

  appendFileSync(summaryPath, `${result.report}\n`);
  return true;
}
