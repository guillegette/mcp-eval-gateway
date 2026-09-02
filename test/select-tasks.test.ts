import { describe, expect, it } from 'vitest';
import { selectTasks } from '../src/select-tasks';

function evalTask(name: string) {
  return { name, prompt: 'hi', expected: 'ok' };
}

function names(tasks: Array<{ name: string }>): string[] {
  return tasks.map((task) => task.name);
}

describe('selectTasks', () => {
  it('returns the same names in the same order when no task or limit is set', () => {
    const tasks = [evalTask('ping'), evalTask('whoami'), evalTask('other')];
    const snapshot = tasks.map((task) => ({ ...task }));

    const selected = selectTasks(tasks, {});

    expect(names(selected)).toEqual(['ping', 'whoami', 'other']);
    expect(tasks).toEqual(snapshot);
  });

  it('matches a case-sensitive substring of the task name', () => {
    const tasks = [evalTask('ping'), evalTask('ping-pong'), evalTask('whoami')];

    expect(names(selectTasks(tasks, { task: ['ping'] }))).toEqual(['ping', 'ping-pong']);
  });

  it('keeps url-paste names and drops ping', () => {
    const tasks = [
      evalTask('ping'),
      evalTask('url-paste-space'),
      evalTask('url-paste-task-panel'),
    ];

    expect(names(selectTasks(tasks, { task: ['url-paste'] }))).toEqual([
      'url-paste-space',
      'url-paste-task-panel',
    ]);
  });

  it('throws when the substring is a different case', () => {
    const tasks = [evalTask('ping')];
    let message = '';
    try {
      selectTasks(tasks, { task: ['PING'] });
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toContain('PING');
    expect(message).toContain('ping');
  });

  it('ORs repeated task patterns and keeps original order', () => {
    const tasks = [evalTask('ping'), evalTask('whoami'), evalTask('other')];

    expect(names(selectTasks(tasks, { task: ['ping', 'whoami'] }))).toEqual([
      'ping',
      'whoami',
    ]);
  });

  it('throws when no name matches, listing the pattern and available names', () => {
    const tasks = [evalTask('ping'), evalTask('whoami')];
    let error: unknown;
    try {
      selectTasks(tasks, { task: ['nope'] });
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain('nope');
    expect(message).toContain('ping');
    expect(message).toContain('whoami');
  });

  it('throws when a task pattern is empty', () => {
    expect(() => selectTasks([evalTask('ping')], { task: [''] })).toThrow(Error);
  });

  it('applies limit to the original array order when there is no task filter', () => {
    const tasks = [
      evalTask('one'),
      evalTask('two'),
      evalTask('three'),
      evalTask('four'),
    ];

    expect(names(selectTasks(tasks, { limit: 2 }))).toEqual(['one', 'two']);
  });

  it('applies limit after the task substring filter', () => {
    const tasks = [
      evalTask('url-paste-space'),
      evalTask('url-paste-task-panel'),
      evalTask('ping'),
    ];

    expect(names(selectTasks(tasks, { task: ['url-paste'], limit: 1 }))).toEqual([
      'url-paste-space',
    ]);
  });

  it('returns every task when limit is larger than the list', () => {
    const tasks = [evalTask('ping'), evalTask('whoami')];

    expect(names(selectTasks(tasks, { limit: 99 }))).toEqual(['ping', 'whoami']);
  });

  it.each([0, -1, 1.5])('throws when limit is %s', (limit) => {
    expect(() => selectTasks([evalTask('ping')], { limit })).toThrow(Error);
  });
});
