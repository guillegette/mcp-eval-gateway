import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { toolsFromMcp } from '../src/index';

const executeOptions = {
  toolCallId: 'test-call',
  messages: [],
  context: undefined,
} as never;

type Adapted = {
  tools: Record<
    string,
    { description?: unknown; execute?: (input: unknown, options: never) => Promise<unknown> }
  >;
  close: () => Promise<void>;
};

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (closers.length > 0) {
    const close = closers.pop();
    if (close) {
      await close().catch(() => undefined);
    }
  }
});

async function connectAdapted(server: McpServer): Promise<Adapted> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const adapted = (await toolsFromMcp({ transport: clientTransport })) as Adapted;
  closers.push(async () => {
    await adapted.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  });
  return adapted;
}

describe('toolsFromMcp', () => {
  it('lists and adapts registered tools', async () => {
    const server = new McpServer({ name: 'eval-test', version: '0.0.0' });
    server.registerTool(
      'echo',
      {
        description: 'Echoes the input',
        inputSchema: { message: z.string() },
      },
      async ({ message }) => ({
        content: [{ type: 'text', text: message }],
      }),
    );

    const { tools } = await connectAdapted(server);

    expect(tools).toHaveProperty('echo');
    expect(tools.echo?.description).toBe('Echoes the input');
  });

  it('execute round-trips input to a text result', async () => {
    const server = new McpServer({ name: 'eval-test', version: '0.0.0' });
    server.registerTool(
      'echo',
      {
        description: 'Echoes the input',
        inputSchema: { message: z.string() },
      },
      async ({ message }) => ({
        content: [{ type: 'text', text: message }],
      }),
    );

    const { tools } = await connectAdapted(server);
    const execute = tools.echo?.execute;
    expect(execute).toEqual(expect.any(Function));

    await expect(execute!({ message: 'hi' }, executeOptions)).resolves.toEqual(
      expect.stringContaining('hi'),
    );
  });

  it('returns isError results as text instead of throwing', async () => {
    const server = new McpServer({ name: 'eval-test', version: '0.0.0' });
    server.registerTool(
      'broken',
      {
        description: 'Always errors',
        inputSchema: {},
      },
      async () => ({
        content: [{ type: 'text', text: 'tool exploded' }],
        isError: true,
      }),
    );

    const { tools } = await connectAdapted(server);
    const execute = tools.broken?.execute;
    expect(execute).toEqual(expect.any(Function));

    await expect(execute!({}, executeOptions)).resolves.toEqual(
      expect.stringContaining('tool exploded'),
    );
  });

  it('rejects execute after close', async () => {
    const server = new McpServer({ name: 'eval-test', version: '0.0.0' });
    server.registerTool(
      'echo',
      {
        description: 'Echoes the input',
        inputSchema: { message: z.string() },
      },
      async ({ message }) => ({
        content: [{ type: 'text', text: message }],
      }),
    );

    const { tools, close } = await connectAdapted(server);
    const execute = tools.echo?.execute;
    expect(execute).toEqual(expect.any(Function));

    await close();
    await expect(execute!({ message: 'hi' }, executeOptions)).rejects.toBeDefined();
  });
});
