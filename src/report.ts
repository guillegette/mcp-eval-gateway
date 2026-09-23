import type { TaskResult } from './types';

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function usedToolNames(result: TaskResult): string[] {
  return Object.entries(result.toolMetrics)
    .filter(([, metric]) => metric.count > 0)
    .map(([name]) => name)
    .sort((a, b) => a.localeCompare(b));
}

function formatToolList(names: string[]): string {
  return names.length === 0 ? 'none' : names.map((name) => `\`${name}\``).join(', ');
}

function tableCell(value: string): string {
  return value.replaceAll('|', '\\|');
}

function tasksByTool(results: TaskResult[]): Map<string, string[]> {
  const usedBy = new Map<string, string[]>();
  for (const result of results) {
    for (const name of usedToolNames(result)) {
      const tasks = usedBy.get(name) ?? [];
      tasks.push(result.name);
      usedBy.set(name, tasks);
    }
  }
  return usedBy;
}

function renderToolCoverage(results: TaskResult[], toolNames: string[]): string {
  if (toolNames.length === 0) {
    return ['## Tool coverage', '', 'No tools were available.'].join('\n');
  }

  const usedBy = tasksByTool(results);
  const names = [...toolNames].sort((a, b) => a.localeCompare(b));
  const invoked = names.filter((name) => usedBy.has(name)).length;
  const pct = ((invoked / names.length) * 100).toFixed(1);
  const lines = [
    '## Tool coverage',
    '',
    `${invoked}/${names.length} invoked (${pct}%)`,
    '',
    '| Tool | Invoked | Tasks |',
    '| --- | --- | --- |',
  ];

  for (const name of names) {
    const tasks = usedBy.get(name);
    const invokedCell = tasks === undefined ? 'no' : 'yes';
    const tasksCell =
      tasks === undefined ? '' : tasks.map((task) => `\`${tableCell(task)}\``).join(', ');
    lines.push(`| \`${tableCell(name)}\` | ${invokedCell} | ${tasksCell} |`);
  }

  return lines.join('\n');
}

function renderTaskIndex(results: TaskResult[]): string {
  const lines = ['## Tasks', '', '| Task | Result | Tools |', '| --- | --- | --- |'];
  for (const result of results) {
    const mark = result.passed ? '✅' : '❌';
    lines.push(
      `| ${tableCell(result.name)} | ${mark} | ${formatToolList(usedToolNames(result))} |`,
    );
  }
  return lines.join('\n');
}

export function renderReport(results: TaskResult[], toolNames: string[]): string {
  const total = results.length;
  const correct = results.filter((result) => result.passed).length;
  const accuracyPct = ((correct / total) * 100).toFixed(1);
  const avgDurationSec = (average(results.map((result) => result.durationMs)) / 1000).toFixed(2);

  const header = [
    '# Evaluation Report',
    '',
    `- **Accuracy**: ${correct}/${total} (${accuracyPct}%)`,
    `- **Average Duration**: ${avgDurationSec}s`,
    '',
    renderToolCoverage(results, toolNames),
    '',
    renderTaskIndex(results),
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
      `**Tools**: ${formatToolList(usedToolNames(result))}`,
      '',
      `**Summary**: ${result.summary ?? 'N/A'}`,
      '',
      `**Feedback**: ${result.feedback ?? 'N/A'}`,
    ].join('\n');
  });

  return [header, ...sections].join('\n\n---\n\n');
}
