import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { FetchLike, Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { dynamicTool, jsonSchema, type JSONSchema7, type ToolSet } from 'ai';

const PACKAGE_VERSION = '0.1.0';

export type ToolsFromMcpOptions =
  | {
      url: string | URL;
      fetch?: FetchLike;
      headers?: Record<string, string>;
    }
  | {
      transport: Transport;
    };

function contentText(result: Awaited<ReturnType<Client['callTool']>>): string {
  if (!('content' in result) || !Array.isArray(result.content)) {
    return '';
  }

  return result.content
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
}

export async function toolsFromMcp(
  options: ToolsFromMcpOptions,
): Promise<{ tools: ToolSet; close: () => Promise<void> }> {
  const transport =
    'transport' in options
      ? options.transport
      : new StreamableHTTPClientTransport(new URL(options.url), {
          fetch: options.fetch,
          requestInit: options.headers ? { headers: options.headers } : undefined,
        });

  const client = new Client({ name: 'mcp-eval-gateway', version: PACKAGE_VERSION });
  await client.connect(transport);

  try {
    const { tools: listed } = await client.listTools();
    const tools: ToolSet = {};

    for (const listedTool of listed) {
      tools[listedTool.name] = dynamicTool({
        description: listedTool.description,
        inputSchema: jsonSchema(listedTool.inputSchema as JSONSchema7),
        execute: async (input) => {
          const result = await client.callTool({
            name: listedTool.name,
            arguments: input as Record<string, unknown>,
          });
          return contentText(result);
        },
      });
    }

    return {
      tools,
      close: () => client.close(),
    };
  } catch (error) {
    await client.close();
    throw error;
  }
}
