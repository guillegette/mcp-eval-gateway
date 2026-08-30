import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const EXISTING_FILES = [
  'config.ts',
  'config.mts',
  'config.mjs',
  'config.js',
  'tasks.yaml',
] as const;

const INIT_CONFIG = `export default {
  model: 'gateway/anthropic/claude-sonnet-4-6',
  threshold: 0.8,
  mcp: {
    url: 'http://localhost/mcp',
    headers: { Authorization: \`Bearer \${process.env.MCP_API_KEY}\` },
  },
};
`;

const INIT_TASKS = `- name: ping
  prompt: Call the ping tool and return its text
  expected: pong
  required: true
`;

export type InitEvalProjectOptions = {
  dir?: string;
};

export function initEvalProject(
  rootDir: string,
  options?: InitEvalProjectOptions,
): void {
  const relativeDir = options?.dir ?? 'eval';
  const evalDir = join(rootDir, relativeDir);

  for (const filename of EXISTING_FILES) {
    if (existsSync(join(evalDir, filename))) {
      throw new Error(`${relativeDir}/${filename} already exists`);
    }
  }

  mkdirSync(evalDir, { recursive: true });
  writeFileSync(join(evalDir, 'config.ts'), INIT_CONFIG);
  writeFileSync(join(evalDir, 'tasks.yaml'), INIT_TASKS);
}
