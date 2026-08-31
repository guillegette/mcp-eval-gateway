import type { TaskResult } from './types';

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function renderReport(results: TaskResult[]): string {
  const total = results.length;
  const correct = results.filter((result) => result.passed).length;
  const accuracyPct = ((correct / total) * 100).toFixed(1);
  const avgDurationSec = (average(results.map((result) => result.durationMs)) / 1000).toFixed(2);
  const toolCallCounts = results.map((result) => result.numToolCalls);
  const totalToolCalls = toolCallCounts.reduce((sum, count) => sum + count, 0);
  const avgToolCalls = average(toolCallCounts).toFixed(2);

  const header = [
    '# Evaluation Report',
    '',
    `- **Accuracy**: ${correct}/${total} (${accuracyPct}%)`,
    `- **Average Duration**: ${avgDurationSec}s`,
    `- **Average Tool Calls**: ${avgToolCalls}`,
    `- **Total Tool Calls**: ${totalToolCalls}`,
  ].join('\n');

  const sections = results.map((result) => {
    const actual = result.actual ?? 'N/A';
    const expectedBlock =
      result.judge !== null
        ? `**Expected Outcome**: ${result.judge}`
        : `**Ground Truth Response**: ${result.expected ?? 'N/A'}`;
    const judgeReasonBlock =
      result.judge !== null
        ? [`**Judge Reason**: ${result.judgeReason ?? 'N/A'}`, '']
        : [];
    return [
      `### Task: ${result.name}`,
      '',
      `**Prompt**: ${result.prompt}`,
      '',
      expectedBlock,
      '',
      `**Actual Response**: ${actual}`,
      '',
      `**Correct**: ${result.passed ? '✅' : '❌'}`,
      '',
      ...judgeReasonBlock,
      `**Duration**: ${(result.durationMs / 1000).toFixed(2)}s`,
      '',
      `**Tool Calls**:`,
      JSON.stringify(result.toolMetrics, null, 2),
      '',
      `**Summary**: ${result.summary ?? 'N/A'}`,
      '',
      `**Feedback**: ${result.feedback ?? 'N/A'}`,
    ].join('\n');
  });

  return [header, ...sections].join('\n\n---\n\n');
}
