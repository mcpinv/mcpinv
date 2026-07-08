import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { BridgeServer } from '../src/server.js'
import type { McpClient } from '../src/mcp-client.js'
import { openDb } from '../src/db.js'
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
    server = new BridgeServer(mockClient(), opts, openDb(':memory:'))
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
    server = new BridgeServer(client, opts, openDb(':memory:'))
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
    server = new BridgeServer(client, opts, openDb(':memory:'))
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

  it('registers with cockpit on start and unregisters on stop', async () => {
    const registered: unknown[] = []
    const unregistered: string[] = []

    // Minimal stub cockpit using Fastify
    const Fastify2 = (await import('fastify')).default
    const stub = Fastify2({ logger: false })
    stub.post('/api/register', async (req: any) => { registered.push(req.body); return { ok: true } })
    stub.delete('/api/register/:id', async (req: any) => { unregistered.push((req.params as any).id); return { ok: true } })
    await stub.listen({ port: 0, host: '127.0.0.1' })
    const stubAddr = stub.server.address() as any
    const stubPort: number = stubAddr.port

    const dbPath = join(tmpdir(), `mcpinv-server-test-${Math.random()}.db`)
    const db = openDb(dbPath)
    const s = new BridgeServer(
      mockClient(),
      { serverId: 'test-server', port: 0, host: '127.0.0.1', logPath: join(tmpdir(), 'test.log'), cockpitUrl: `http://127.0.0.1:${stubPort}` },
      db
    )

    await s.start()
    // Give the fire-and-forget registration a moment to complete
    await new Promise(r => setTimeout(r, 100))
    await s.stop()
    // Give the stop unregistration a moment (it's awaited but just in case)
    await new Promise(r => setTimeout(r, 100))
    await stub.close()
    db.close()

    expect(registered).toHaveLength(1)
    expect((registered[0] as any).server_id).toBe('test-server')
    expect(unregistered).toContain('test-server')
  })
})
