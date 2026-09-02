import { styleText } from 'node:util';
import type { TranscriptEntry } from './judge';
import type { EvalRunResult, TaskResult } from './types';

export function formatRunHeader(info: {
  model: string;
  judge?: string;
  mcp: string;
  tasks: number;
}): string {
  const judgePart = info.judge !== undefined ? `  judge ${info.judge}` : '';
  return `Evaluating ${info.model}${judgePart}  MCP ${info.mcp}  ${info.tasks} tasks`;
}

export function formatPhase(message: string): string {
  return message;
}

export function formatTaskStart(info: {
  index: number;
  total: number;
  name: string;
}): string {
  return `  RUN  [${info.index + 1}/${info.total}] ${info.name}`;
}

export function formatTaskEnd(
  result: TaskResult,
  info: { index: number; total: number },
): string {
  const status = result.passed ? 'PASS' : 'FAIL';
  const seconds = `${(result.durationMs / 1000).toFixed(2)}s`;
  const tools = result.numToolCalls === 1 ? '1 tool' : `${result.numToolCalls} tools`;
  const judgeToken = result.judge !== null ? '  judge' : '';
  const line = `  ${status} [${info.index + 1}/${info.total}] ${result.name}  ${seconds}  ${tools}${judgeToken}`;
  if (result.passed) {
    return line;
  }
  if (result.judge !== null) {
    return `${line}\n    judge: ${result.judge}\n    reason: ${result.judgeReason ?? ''}`;
  }
  return `${line}\n    expected: ${result.expected}\n    actual: ${result.actual}`;
}

export function formatTranscript(entries: TranscriptEntry[]): string {
  if (entries.length === 0) {
    return '  no tool calls';
  }
  return entries
    .map(
      (entry) =>
        `  ${entry.tool}\n    input ${JSON.stringify(entry.input)}\n    output ${JSON.stringify(entry.output)}`,
    )
    .join('\n');
}

export function formatRunFooter(
  result: EvalRunResult,
  options?: { threshold?: number; durationMs: number },
): string {
  const failed = result.total - result.correct;
  const accuracyPct = ((result.correct / result.total) * 100).toFixed(1);
  const durationMs = options?.durationMs ?? 0;
  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const elapsed = `${minutes}m${String(seconds).padStart(2, '0')}s`;
  const threshold =
    options?.threshold !== undefined
      ? `  threshold ${(options.threshold * 100).toFixed(0)}%`
      : '';
  return `${result.correct} passed  ${failed} failed  ${result.total} total  ${accuracyPct}%${threshold}  ${elapsed}`;
}

export function createReporter(
  write: (chunk: string) => void,
  options?: { verbose?: boolean },
) {
  const colorStatus = (line: string): string =>
    line
      .replaceAll('PASS', styleText('green', 'PASS'))
      .replaceAll('FAIL', styleText('red', 'FAIL'))
      .replaceAll('RUN', styleText(['dim', 'cyan'], 'RUN'));

  return {
    onRunStart(info: { model: string; judge?: string; mcp: string; tasks: number }) {
      write(`${colorStatus(formatRunHeader(info))}\n`);
    },
    onPhase(message: string) {
      write(`${formatPhase(message)}\n`);
    },
    onTaskStart(info: { index: number; total: number; name: string }) {
      write(`${colorStatus(formatTaskStart(info))}\n`);
    },
    onTaskEnd(result: TaskResult, info: { index: number; total: number }) {
      write(`${colorStatus(formatTaskEnd(result, info))}\n`);
      if (options?.verbose === true) {
        write(`${formatTranscript(result.transcript)}\n`);
      }
    },
    onRunEnd(result: EvalRunResult, endOptions: { threshold?: number; durationMs: number }) {
      write(`${formatRunFooter(result, endOptions)}\n`);
    },
  };
}

export type EvalReporter = ReturnType<typeof createReporter>;
