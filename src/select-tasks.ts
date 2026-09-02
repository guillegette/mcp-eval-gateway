import type { EvalTask } from './types';

export function selectTasks(
  tasks: EvalTask[],
  options?: { task?: string[]; limit?: number },
): EvalTask[] {
  let selected = tasks;

  const patterns = options?.task;
  if (patterns !== undefined && patterns.length > 0) {
    if (patterns.some((pattern) => typeof pattern !== 'string' || pattern.length === 0)) {
      throw new Error('Each --task pattern must be a non-empty string');
    }

    selected = tasks.filter((task) =>
      patterns.some((pattern) => task.name.includes(pattern)),
    );

    if (selected.length === 0) {
      throw new Error(
        `No tasks matched ${patterns.join(', ')}. Available: ${tasks
          .map((task) => task.name)
          .join(', ')}`,
      );
    }
  }

  const limit = options?.limit;
  if (typeof limit === 'number') {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error(`limit must be an integer >= 1, got ${limit}`);
    }
    selected = selected.slice(0, limit);
  }

  return selected;
}
