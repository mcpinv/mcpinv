import type { Tool } from '@modelcontextprotocol/sdk/types.js'

export function generateOpenApiSpec(serverId: string, tools: Tool[]): object {
  const paths: Record<string, object> = {}

  for (const tool of tools) {
    paths[`/tools/${tool.name}`] = {
      post: {
        operationId: tool.name,
        summary: tool.description ?? tool.name,
        description: tool.description ?? '',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: tool.inputSchema ?? { type: 'object', properties: {} }
            }
          }
        },
        responses: {
          '200': {
            description: 'Tool result',
            content: { 'application/json': { schema: { type: 'object' } } }
          },
          '400': { description: 'Invalid parameters' },
          '422': { description: 'Tool execution failed' }
        }
      }
    }
  }

  return {
    openapi: '3.1.0',
    info: {
      title: `${serverId} MCP Bridge`,
      description: `REST bridge for the ${serverId} MCP server, powered by mcpinv`,
      version: '1.0.0'
    },
    paths
  }
}
