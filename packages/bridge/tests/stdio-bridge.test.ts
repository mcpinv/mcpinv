import { describe, it, expect, vi, afterEach } from 'vitest'
import { PassThrough } from 'stream'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { openDb } from '../src/db.js'
import { StdioBridge } from '../src/stdio-bridge.js'
import type { McpClient } from '../src/mcp-client.js'

function mockClient(overrides: Partial<McpClient> = {}): McpClient {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    listTools: vi.fn().mockResolvedValue([
      { name: 'ping', description: 'Ping', inputSchema: { type: 'object', properties: {} } }
    ]),
    callTool: vi.fn().mockResolvedValue([{ type: 'text', text: 'pong' }]),
    close: vi.fn().mockResolvedValue(undefined),
    ...overrides
  } as unknown as McpClient
}

function makeStreams() {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  return { stdin, stdout }
}

describe('StdioBridge', () => {
  let bridge: StdioBridge | null = null

  afterEach(async () => { await bridge?.stop(); bridge = null })

  it('connects to upstream MCP client on start', async () => {
    const client = mockClient()
    const db = openDb(join(tmpdir(), `mcpinv-stdio-test-${randomUUID()}.db`))
    const { stdin, stdout } = makeStreams()
    bridge = new StdioBridge(client, {
      serverId: 'test-server',
      dbPath: ':memory:',
      logPath: join(tmpdir(), 'stdio-test.log')
    }, db, stdin, stdout)

    await bridge.start()

    expect(client.connect).toHaveBeenCalledOnce()
    expect(client.listTools).toHaveBeenCalledOnce()
    db.close()
  })

  it('calls upsertKnownServer on start', async () => {
    const client = mockClient()
    const dbPath = join(tmpdir(), `mcpinv-stdio-test-${randomUUID()}.db`)
    const db = openDb(dbPath)
    const { stdin, stdout } = makeStreams()
    bridge = new StdioBridge(client, {
      serverId: 'my-server',
      logPath: join(tmpdir(), 'stdio-test.log')
    }, db, stdin, stdout)

    await bridge.start()

    const { listKnownServers } = await import('../src/db.js')
    const known = listKnownServers(db)
    expect(known.some(s => s.id === 'my-server')).toBe(true)
    db.close()
  })

  it('forwards upstream tool inputSchema to downstream registration', async () => {
    const schema = {
      type: 'object' as const,
      properties: { path: { type: 'string' } },
      required: ['path']
    }
    const client = mockClient({
      listTools: vi.fn().mockResolvedValue([
        { name: 'read_file', description: 'Read a file', inputSchema: schema }
      ])
    })
    const db = openDb(join(tmpdir(), `mcpinv-stdio-test-${randomUUID()}.db`))
    const { stdin, stdout } = makeStreams()

    // Spy on Server.prototype.setRequestHandler to capture the ListTools handler
    // directly — avoids fragile raw-stdio parsing (MCP uses Content-Length framing,
    // not bare newline-delimited JSON).
    type HandlerFn = () => unknown
    let capturedListToolsHandler: HandlerFn | null = null
    const origSetRequestHandler = Server.prototype.setRequestHandler
    vi.spyOn(Server.prototype, 'setRequestHandler').mockImplementation(
      function (this: Server, schema: unknown, handler: HandlerFn) {
        if (schema === ListToolsRequestSchema) {
          capturedListToolsHandler = handler
        }
        return origSetRequestHandler.call(this, schema as Parameters<typeof origSetRequestHandler>[0], handler as Parameters<typeof origSetRequestHandler>[1])
      }
    )

    bridge = new StdioBridge(client, {
      serverId: 'schema-test-server',
      logPath: join(tmpdir(), 'stdio-test.log')
    }, db, stdin, stdout)

    await bridge.start()

    vi.restoreAllMocks()

    expect(capturedListToolsHandler).not.toBeNull()
    const result = (capturedListToolsHandler as HandlerFn)() as { tools: Array<{ name: string; inputSchema: unknown }> }
    const readFileTool = result.tools.find((t) => t.name === 'read_file')

    expect(readFileTool).toBeDefined()
    expect(readFileTool?.inputSchema).toMatchObject({
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path']
    })
    db.close()
  })

  it('passes arguments through to callTool for a tool with inputSchema', async () => {
    const schema = {
      type: 'object' as const,
      properties: { path: { type: 'string' } },
      required: ['path']
    }
    const callTool = vi.fn().mockResolvedValue([{ type: 'text', text: 'file contents' }])
    const client = mockClient({
      listTools: vi.fn().mockResolvedValue([
        { name: 'read_file', description: 'Read a file', inputSchema: schema }
      ]),
      callTool
    })
    const db = openDb(join(tmpdir(), `mcpinv-stdio-test-${randomUUID()}.db`))
    const { stdin, stdout } = makeStreams()
    bridge = new StdioBridge(client, {
      serverId: 'args-test-server',
      logPath: join(tmpdir(), 'stdio-test.log')
    }, db, stdin, stdout)

    await bridge.start()

    // Send initialize then tools/call to exercise the argument forwarding path.
    const initRequest = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' }
      }
    })
    const callRequest = JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'read_file', arguments: { path: '/tmp/foo.txt' } }
    })

    await new Promise<void>((resolve) => {
      let msgCount = 0
      stdout.on('data', () => {
        msgCount++
        // We need at least 2 responses: initialize reply + tools/call reply
        if (msgCount >= 2) resolve()
      })
      stdin.write(initRequest + '\n')
      // Wait for the initialize response before sending the call; 200 ms is
      // sufficient headroom because the mock client resolves synchronously —
      // a bare setTimeout is unavoidable here since the SDK's stdio framing
      // does not expose a per-message completion event on PassThrough streams.
      setTimeout(() => stdin.write(callRequest + '\n'), 200)
    })

    expect(callTool).toHaveBeenCalledWith('read_file', { path: '/tmp/foo.txt' })
    db.close()
  })

  it('stop is idempotent', async () => {
    const client = mockClient()
    const db = openDb(join(tmpdir(), `mcpinv-stdio-test-${randomUUID()}.db`))
    const { stdin, stdout } = makeStreams()
    bridge = new StdioBridge(client, {
      serverId: 'test-server',
      logPath: join(tmpdir(), 'stdio-test.log')
    }, db, stdin, stdout)

    await bridge.start()
    await bridge.stop()
    await expect(bridge.stop()).resolves.not.toThrow()
    bridge = null
    db.close()
  })
})
