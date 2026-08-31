import { tool } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { runEvals } from '../src/index';
import {
  collectStrings,
  textGenerateResult,
  textModel,
  toolCallGenerateResult,
  toolThenTextModel,
} from './helpers';

function firstResult(result: Awaited<ReturnType<typeof runEvals>>) {
  const taskResult = result.results[0];
  if (taskResult === undefined) {
    throw new Error('expected a task result');
  }
  return taskResult;
}

function verdictJudge(verdict: 'yes' | 'no', reason: string): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doGenerate: async () => toolCallGenerateResult('report_verdict', { verdict, reason }),
  });
}

function createTaskTool(execute: (input: { text: string }) => Promise<unknown> | unknown) {
  return tool({
    description: 'Create a task',
    inputSchema: z.object({ text: z.string() }),
    execute,
  });
}

describe('runEvals judge tasks', () => {
  it('judge verdict yes passes the task', async () => {
    const result = await runEvals({
      model: textModel('<response>created it</response>'),
      tools: {},
      tasks: [
        {
          name: 'create-space',
          prompt: 'Set up a project for onboarding',
          judge: 'A new space is created with three tasks',
        },
      ],
      judgeModel: verdictJudge('yes', 'space and tasks were created'),
    });

    const taskResult = firstResult(result);
    expect(taskResult.passed).toBe(true);
    expect(taskResult.score).toBe(1);
    expect(taskResult.judgeReason).toBe('space and tasks were created');
    expect(taskResult.judge).toBe('A new space is created with three tasks');
    expect(taskResult.expected).toBeNull();
  });

  it('judge verdict no fails the task', async () => {
    const result = await runEvals({
      model: textModel('<response>created it</response>'),
      tools: {},
      tasks: [
        {
          name: 'create-space',
          prompt: 'Set up a project for onboarding',
          judge: 'A new space is created with three tasks',
        },
      ],
      judgeModel: verdictJudge('no', 'no create tool was called'),
    });

    const taskResult = firstResult(result);
    expect(taskResult.passed).toBe(false);
    expect(taskResult.score).toBe(0);
    expect(taskResult.judgeReason).toBe('no create tool was called');
  });

  it('a judge reply without a verdict tool call fails the task', async () => {
    const result = await runEvals({
      model: textModel('<response>created it</response>'),
      tools: {},
      tasks: [
        {
          name: 'create-space',
          prompt: 'Set up a project for onboarding',
          judge: 'A new space is created with three tasks',
        },
      ],
      judgeModel: textModel('looks good to me'),
    });

    const taskResult = firstResult(result);
    expect(taskResult.score).toBe(0);
    expect(taskResult.passed).toBe(false);
    expect(typeof taskResult.judgeReason).toBe('string');
    expect(taskResult.judgeReason).not.toBe('');
  });

  it('judge defaults to the eval model', async () => {
    let calls = 0;
    const model = new MockLanguageModelV3({
      doGenerate: async () => {
        calls += 1;
        if (calls === 1) {
          return textGenerateResult('<response>done</response>');
        }
        return toolCallGenerateResult('report_verdict', { verdict: 'yes', reason: 'ok' });
      },
    });

    const result = await runEvals({
      model,
      tools: {},
      tasks: [
        {
          name: 'create-space',
          prompt: 'Set up a project for onboarding',
          judge: 'A new space is created with three tasks',
        },
      ],
    });

    expect(calls).toBe(2);
    expect(firstResult(result).passed).toBe(true);
  });

  it('the judge sees the tool transcript, rubric, and final response', async () => {
    const evalModel = toolThenTextModel(
      'create_task',
      { text: 'Buy milk' },
      '<response>task created</response>',
    );
    const prompts: unknown[] = [];
    const judgeModel = new MockLanguageModelV3({
      doGenerate: async (options) => {
        prompts.push(options.prompt);
        return toolCallGenerateResult('report_verdict', { verdict: 'yes', reason: 'ok' });
      },
    });

    await runEvals({
      model: evalModel,
      tools: {
        create_task: createTaskTool(async () => ({ id: 'task-9', text: 'Buy milk' })),
      },
      tasks: [
        {
          name: 'buy-milk',
          prompt: 'Create a grocery task',
          judge: 'A task named Buy milk is created',
        },
      ],
      judgeModel,
    });

    const strings = collectStrings(prompts);
    expect(strings.some((text) => text.includes('create_task'))).toBe(true);
    expect(strings.some((text) => text.includes('Buy milk'))).toBe(true);
    expect(strings.some((text) => text.includes('task-9'))).toBe(true);
    expect(strings.some((text) => text.includes('A task named Buy milk is created'))).toBe(true);
    expect(strings.some((text) => text.includes('task created'))).toBe(true);
  });

  it('oversized tool outputs are truncated for the judge', async () => {
    const blob = 'x'.repeat(60000);
    const evalModel = toolThenTextModel(
      'create_task',
      { text: 'Buy milk' },
      '<response>task created</response>',
    );
    const prompts: unknown[] = [];
    const judgeModel = new MockLanguageModelV3({
      doGenerate: async (options) => {
        prompts.push(options.prompt);
        return toolCallGenerateResult('report_verdict', { verdict: 'yes', reason: 'ok' });
      },
    });

    const result = await runEvals({
      model: evalModel,
      tools: {
        create_task: createTaskTool(async () => ({ id: 'task-9', blob })),
      },
      tasks: [
        {
          name: 'buy-milk',
          prompt: 'Create a grocery task',
          judge: 'A task named Buy milk is created',
        },
      ],
      judgeModel,
    });

    const strings = collectStrings(prompts);
    expect(strings.every((text) => !text.includes(blob))).toBe(true);
    expect(strings.some((text) => text.includes('[truncated]'))).toBe(true);
    expect(firstResult(result).passed).toBe(true);
  });

  it('exact-match tasks never call the judge', async () => {
    const doGenerate = vi.fn();
    const judgeModel = new MockLanguageModelV3({ doGenerate });

    const result = await runEvals({
      model: textModel('<response>pong</response>'),
      tools: {},
      tasks: [{ name: 'ping', prompt: 'ping', expected: 'pong' }],
      judgeModel,
    });

    expect(result.results[0]?.passed).toBe(true);
    expect(doGenerate).not.toHaveBeenCalled();
  });

  it('a task with both expected and judge rejects', async () => {
    const error = await runEvals({
      model: textModel('<response>pong</response>'),
      tools: {},
      tasks: [
        {
          name: 'ping',
          prompt: 'ping',
          expected: 'pong',
          judge: 'the agent replies pong',
        },
      ],
    }).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('ping');
    expect((error as Error).message).toMatch(/exactly one/);
  });

  it('a task with neither expected nor judge rejects', async () => {
    const error = await runEvals({
      model: textModel('<response>pong</response>'),
      tools: {},
      tasks: [{ name: 'ping', prompt: 'ping' }],
    }).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('ping');
    expect((error as Error).message).toMatch(/exactly one/);
  });

  it('the report renders rubric and judge reason', async () => {
    const result = await runEvals({
      model: textModel('<response>created it</response>'),
      tools: {},
      tasks: [
        {
          name: 'create-space',
          prompt: 'Set up a project for onboarding',
          judge: 'A new space is created',
        },
      ],
      judgeModel: verdictJudge('yes', 'verified in transcript'),
    });

    expect(result.report).toContain('Expected Outcome');
    expect(result.report).toContain('A new space is created');
    expect(result.report).toContain('Judge Reason');
    expect(result.report).toContain('verified in transcript');
    expect(result.report).not.toContain('Ground Truth Response');
  });
});
