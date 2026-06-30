import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import type { McpClientOptions } from './types.js'

export class McpClient {
  private client: Client
  private transport: StdioClientTransport
  private _connected = false
  private _closed = false

  constructor(private readonly options: McpClientOptions) {
    this.transport = new StdioClientTransport({
      command: options.command,
      args: options.args,
      env: Object.fromEntries(
        Object.entries({ ...process.env, ...(options.env ?? {}) })
          .filter((entry): entry is [string, string] => entry[1] !== undefined)
      )
    })
    this.client = new Client({ name: 'mcpinv-bridge', version: '1.0.0' }, {})
  }

  async connect(): Promise<void> {
    if (this._connected) throw new Error('Already connected')
    await this.client.connect(this.transport)
    this._connected = true
  }

  async listTools(): Promise<Tool[]> {
    const result = await this.client.listTools()
    if (!Array.isArray(result.tools)) {
      throw new Error(`Invalid listTools response: ${JSON.stringify(result)}`)
    }
    return result.tools
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const result = await this.client.callTool({ name, arguments: args })
    return result.content
  }

  async close(): Promise<void> {
    if (this._closed) return
    try {
      await this.client.close()
    } finally {
      this._closed = true
      this._connected = false
    }
  }
}
