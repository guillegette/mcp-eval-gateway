import { tool } from 'ai';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { runEvals, type EvalTask } from '../src/index';
import {
  collectStrings,
  textGenerateResult,
  textModel,
  toolThenTextModel,
} from './helpers';
import { MockLanguageModelV3 } from 'ai/test';

const stripDollarScorer = (actual: string | null, task: EvalTask): number => {
  const normalized = actual?.replace(/^\$/, '') ?? null;
  return normalized === task.expected ? 1 : 0;
};

function calculatorTool(execute: (input: { expression: string }) => Promise<string> | string) {
  return tool({
    description: 'Evaluate a math expression',
    inputSchema: z.object({ expression: z.string() }),
    execute,
  });
}

describe('runEvals', () => {
  it('throws when no tasks are provided', async () => {
    await expect(runEvals({ model: textModel('unused'), tools: {}, tasks: [] })).rejects.toThrow(
      /No tasks ran/,
    );
  });

  it('exact match passes and extracts the last tagged fields', async () => {
    const result = await runEvals({
      model: textModel(
        '<summary>did math</summary><feedback>tool was fine</feedback><response>42</response>',
      ),
      tools: {},
      tasks: [{ name: 'answer-42', prompt: 'What is 6*7?', expected: '42' }],
    });

    expect(result.total).toBe(1);
    expect(result.correct).toBe(1);
    expect(result.accuracy).toBe(1);
    expect(result.results[0]?.actual).toBe('42');
    expect(result.results[0]?.score).toBe(1);
    expect(result.results[0]?.passed).toBe(true);
    expect(result.results[0]?.summary).toBe('did math');
    expect(result.results[0]?.feedback).toBe('tool was fine');
    expect(result.results[0]?.transcript).toEqual([]);
  });

  it('mismatch fails', async () => {
    const result = await runEvals({
      model: textModel('<response>$42</response>'),
      tools: {},
      tasks: [{ name: 'answer-42', prompt: 'What is 6*7?', expected: '42' }],
    });

    expect(result.results[0]?.score).toBe(0);
    expect(result.results[0]?.passed).toBe(false);
    expect(result.results[0]?.actual).toBe('$42');
    expect(result.accuracy).toBe(0);
  });

  it('missing response tag yields null actual and related fields', async () => {
    const result = await runEvals({
      model: textModel('the answer is forty two'),
      tools: {},
      tasks: [{ name: 'answer-42', prompt: 'What is 6*7?', expected: '42' }],
    });

    expect(result.results[0]?.actual).toBeNull();
    expect(result.results[0]?.score).toBe(0);
    expect(result.results[0]?.summary).toBeNull();
    expect(result.results[0]?.feedback).toBeNull();
  });

  it('last response tag wins', async () => {
    const result = await runEvals({
      model: textModel('<response>first</response> scratch work <response>second</response>'),
      tools: {},
      tasks: [{ name: 'last-tag', prompt: 'Pick one', expected: 'second' }],
    });

    expect(result.results[0]?.actual).toBe('second');
  });

  it('tool loop records per-tool metrics', async () => {
    const execute = vi.fn(async (_input: { expression: string }) => '42');
    const model = toolThenTextModel(
      'calculator',
      { expression: '6*7' },
      '<response>42</response>',
    );

    const result = await runEvals({
      model,
      tools: { calculator: calculatorTool(execute) },
      tasks: [{ name: 'calc-42', prompt: 'What is 6*7?', expected: '42' }],
    });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(
      { expression: '6*7' },
      expect.anything(),
    );

    const metrics = result.results[0]?.toolMetrics.calculator;
    expect(metrics?.count).toBe(1);
    expect(metrics?.durationsMs).toHaveLength(1);
    expect(metrics?.durationsMs[0]).toBeGreaterThanOrEqual(0);
    expect(result.results[0]?.numToolCalls).toBe(1);
    expect(result.results[0]?.passed).toBe(true);

    const transcript = result.results[0]?.transcript;
    expect(transcript).toHaveLength(1);
    expect(transcript?.[0]?.tool).toBe('calculator');
    expect(transcript?.[0]?.input).toEqual({ expression: '6*7' });
    expect(String(transcript?.[0]?.output)).toContain('42');
  });

  it('tool execute errors continue the loop with an error result string', async () => {
    const execute = vi.fn(async (_input: { expression: string }) => {
      throw new Error('boom');
    });
    const model = toolThenTextModel(
      'calculator',
      { expression: '6*7' },
      '<response>42</response>',
    );

    const result = await runEvals({
      model,
      tools: { calculator: calculatorTool(execute) },
      tasks: [{ name: 'calc-error', prompt: 'What is 6*7?', expected: '42' }],
    });

    expect(result.results[0]?.passed).toBe(true);
    expect(result.results[0]?.actual).toBe('42');

    const secondPrompt = model.prompts[1];
    expect(secondPrompt).toBeDefined();
    const strings = collectStrings(secondPrompt);
    expect(
      strings.some(
        (text) => text.startsWith('Error executing tool calculator:') && text.includes('boom'),
      ),
    ).toBe(true);

    const transcript = result.results[0]?.transcript;
    expect(transcript).toHaveLength(1);
    expect(transcript?.[0]?.tool).toBe('calculator');
    expect(String(transcript?.[0]?.output)).toContain('Error executing tool calculator');
    expect(String(transcript?.[0]?.output)).toContain('boom');
  });

  it('task-level scorer overrides the default', async () => {
    const result = await runEvals({
      model: textModel('<response>$42</response>'),
      tools: {},
      tasks: [
        {
          name: 'currency',
          prompt: 'What is 6*7?',
          expected: '42',
          scorer: stripDollarScorer,
        },
      ],
    });

    expect(result.results[0]?.score).toBe(1);
    expect(result.results[0]?.passed).toBe(true);
  });

  it('run-level scorer applies when the task has none', async () => {
    const result = await runEvals({
      model: textModel('<response>$42</response>'),
      tools: {},
      tasks: [{ name: 'currency', prompt: 'What is 6*7?', expected: '42' }],
      scorer: stripDollarScorer,
    });

    expect(result.results[0]?.passed).toBe(true);
  });

  it('runs each task setup before that task\'s model call', async () => {
    const order: string[] = [];
    const setup1 = vi.fn(() => {
      order.push('setup-1');
    });
    const setup2 = vi.fn(() => {
      order.push('setup-2');
    });

    const model = new MockLanguageModelV3({
      doGenerate: async () => {
        order.push('model');
        return textGenerateResult('<response>ok</response>');
      },
    });

    await runEvals({
      model,
      tools: {},
      tasks: [
        { name: 'first', prompt: 'task one', expected: 'ok', setup: setup1 },
        { name: 'second', prompt: 'task two', expected: 'ok', setup: setup2 },
      ],
    });

    expect(setup1).toHaveBeenCalledTimes(1);
    expect(setup2).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['setup-1', 'model', 'setup-2', 'model']);
  });

  it('aggregates accuracy across passing and failing tasks', async () => {
    const result = await runTwoTaskAggregate();

    expect(result.correct).toBe(1);
    expect(result.total).toBe(2);
    expect(result.accuracy).toBe(0.5);
  });

  it('report includes accuracy, prompts, expected values, and pass/fail marks', async () => {
    const result = await runTwoTaskAggregate();

    expect(result.report).toContain('1/2');
    expect(result.report).toContain('What is 6*7?');
    expect(result.report).toContain('Name a color');
    expect(result.report).toContain('42');
    expect(result.report).toContain('blue');
    expect(result.report).toContain('✅');
    expect(result.report).toContain('❌');
  });

  it('fires onTaskStart before onTaskEnd for a single passing task', async () => {
    const onTaskStart = vi.fn();
    const onTaskEnd = vi.fn();
    const order: string[] = [];
    onTaskStart.mockImplementation(() => {
      order.push('start');
    });
    onTaskEnd.mockImplementation(() => {
      order.push('end');
    });

    await runEvals({
      model: textModel('<response>42</response>'),
      tools: {},
      tasks: [{ name: 'answer-42', prompt: 'What is 6*7?', expected: '42' }],
      onTaskStart,
      onTaskEnd,
    } as Parameters<typeof runEvals>[0]);

    expect(onTaskStart).toHaveBeenCalledTimes(1);
    expect(onTaskEnd).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['start', 'end']);

    const startArgs = onTaskStart.mock.calls[0];
    expect(startArgs?.[0]?.name).toBe('answer-42');
    expect(startArgs?.[1]).toBe(0);
    expect(startArgs?.[2]).toBe(1);

    const endArgs = onTaskEnd.mock.calls[0];
    expect(endArgs?.[0]?.name).toBe('answer-42');
    expect(endArgs?.[0]?.passed).toBe(true);
    expect(endArgs?.[1]).toBe(0);
    expect(endArgs?.[2]).toBe(1);
  });

  it('runs start and end callbacks in task order for two tasks', async () => {
    const calls: string[] = [];

    await runEvals({
      model: textModel('<response>42</response>'),
      tools: {},
      tasks: [
        { name: 'a', prompt: 'first', expected: '42' },
        { name: 'b', prompt: 'second', expected: '42' },
      ],
      onTaskStart: (evalTask: EvalTask) => {
        calls.push(`start:${evalTask.name}`);
      },
      onTaskEnd: (result: { name: string }) => {
        calls.push(`end:${result.name}`);
      },
    } as Parameters<typeof runEvals>[0]);

    expect(calls).toEqual(['start:a', 'end:a', 'start:b', 'end:b']);
  });
});

async function runTwoTaskAggregate() {
  let calls = 0;
  const model = new MockLanguageModelV3({
    doGenerate: async () => {
      calls += 1;
      return textGenerateResult(
        calls === 1 ? '<response>42</response>' : '<response>red</response>',
      );
    },
  });

  return runEvals({
    model,
    tools: {},
    tasks: [
      { name: 'math', prompt: 'What is 6*7?', expected: '42' },
      { name: 'color', prompt: 'Name a color', expected: 'blue' },
    ],
  });
}
