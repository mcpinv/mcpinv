import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    listTools: vi.fn().mockResolvedValue({ tools: [{ name: 'search', description: 'Search', inputSchema: { type: 'object' } }] }),
    callTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'result' }] }),
    close: vi.fn().mockResolvedValue(undefined)
  }))
}))

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: vi.fn().mockImplementation(() => ({}))
}))

import { McpClient } from '../src/mcp-client.js'

describe('McpClient', () => {
  let client: McpClient

  beforeEach(() => {
    client = new McpClient({ command: 'node', args: ['server.js'] })
  })

  it('connects and lists tools', async () => {
    await client.connect()
    const tools = await client.listTools()
    expect(tools).toHaveLength(1)
    expect(tools[0].name).toBe('search')
  })

  it('calls a tool and returns content', async () => {
    await client.connect()
    const result = await client.callTool('search', { query: 'test' })
    expect(result).toEqual([{ type: 'text', text: 'result' }])
  })

  it('closes cleanly', async () => {
    await client.connect()
    await expect(client.close()).resolves.toBeUndefined()
  })
})
