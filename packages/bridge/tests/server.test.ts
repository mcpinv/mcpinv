import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { BridgeServer } from '../src/server.js'
import type { McpClient } from '../src/mcp-client.js'
import { tmpdir } from 'os'
import { join } from 'path'

const mockTools: Tool[] = [
  { name: 'ping', description: 'Ping', inputSchema: { type: 'object', properties: {} } }
]

function mockClient(overrides: Partial<McpClient> = {}): McpClient {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    listTools: vi.fn().mockResolvedValue(mockTools),
    callTool: vi.fn().mockResolvedValue([{ type: 'text', text: 'pong' }]),
    close: vi.fn().mockResolvedValue(undefined),
    ...overrides
  } as unknown as McpClient
}

describe('BridgeServer', () => {
  let server: BridgeServer
  const opts = { serverId: 'test', port: 3099, host: '127.0.0.1', logPath: join(tmpdir(), 'bridge-test.log') }

  beforeEach(() => {
    server = new BridgeServer(mockClient(), opts)
  })

  afterEach(async () => {
    await server.stop()
  })

  it('starts and serves /openapi.json', async () => {
    await server.start()
    const res = await fetch('http://127.0.0.1:3099/openapi.json')
    const json = await res.json() as any
    expect(json.openapi).toBe('3.1.0')
    expect(json.paths['/tools/ping']).toBeDefined()
  })

  it('serves GET /tools', async () => {
    await server.start()
    const res = await fetch('http://127.0.0.1:3099/tools')
    const json = await res.json() as any
    expect(json.tools[0].name).toBe('ping')
  })

  it('calls a tool via POST /tools/:name', async () => {
    const client = mockClient()
    server = new BridgeServer(client, opts)
    await server.start()
    const res = await fetch('http://127.0.0.1:3099/tools/ping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    })
    expect(res.status).toBe(200)
  })

  it('returns 404 for unknown tool', async () => {
    await server.start()
    const res = await fetch('http://127.0.0.1:3099/tools/unknown', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    })
    expect(res.status).toBe(404)
  })

  it('returns 422 when tool call throws', async () => {
    const client = mockClient({
      callTool: vi.fn().mockRejectedValue(new Error('upstream error'))
    } as any)
    server = new BridgeServer(client, opts)
    await server.start()
    const res = await fetch('http://127.0.0.1:3099/tools/ping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    })
    expect(res.status).toBe(422)
    const json = await res.json() as any
    expect(json.error).toBe('tool_failed')
  })

  it('hot-swaps tools and updates spec', async () => {
    await server.start()
    const newTools: Tool[] = [
      { name: 'ping', description: 'Ping', inputSchema: { type: 'object', properties: {} } },
      { name: 'create_issue', description: 'Create issue', inputSchema: { type: 'object', properties: {} } }
    ]
    server.updateTools(newTools)
    const res = await fetch('http://127.0.0.1:3099/openapi.json')
    const json = await res.json() as any
    expect(json.paths['/tools/create_issue']).toBeDefined()
  })
})
