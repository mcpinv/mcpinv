import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import type { McpClientOptions } from './types.js'

export class McpClient {
  private client: Client
  private transport: StdioClientTransport

  constructor(private readonly options: McpClientOptions) {
    this.transport = new StdioClientTransport({
      command: options.command,
      args: options.args,
      env: { ...process.env, ...(options.env ?? {}) } as Record<string, string>
    })
    this.client = new Client({ name: 'mcpinv-bridge', version: '1.0.0' }, {})
  }

  async connect(): Promise<void> {
    await this.client.connect(this.transport)
  }

  async listTools(): Promise<Tool[]> {
    const result = await this.client.listTools()
    return result.tools
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const result = await this.client.callTool({ name, arguments: args })
    return result.content
  }

  async close(): Promise<void> {
    await this.client.close()
  }
}
