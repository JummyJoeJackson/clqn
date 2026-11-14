import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ClqnClient, VERSION } from '@clqn/shared';

export function createMcpServer(client: ClqnClient) {
  const server = new McpServer({ name: 'clqn', version: VERSION });
  server.registerTool('clqn_health', {
    description: 'Check clqn API liveness. Does not report clan status or database readiness.',
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  }, async () => {
    try {
      return { content: [{ type: 'text' as const, text: JSON.stringify(await client.health()) }] };
    } catch (error) {
      return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : 'API request failed' }] };
    }
  });
  return server;
}

export async function serveMcp(client: ClqnClient): Promise<void> {
  await createMcpServer(client).connect(new StdioServerTransport());
}
