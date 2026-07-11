import { describe, it, expect, vi, afterEach } from 'vitest'
import { PassThrough } from 'stream'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
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
    const callTool = vi.fn().mockResolvedValue([{ type: 'text', text: 'result' }])
    const client = mockClient({
      listTools: vi.fn().mockResolvedValue([
        { name: 'read_file', description: 'Read a file', inputSchema: schema }
      ]),
      callTool
    })
    const db = openDb(join(tmpdir(), `mcpinv-stdio-test-${randomUUID()}.db`))
    const { stdin, stdout } = makeStreams()
    bridge = new StdioBridge(client, {
      serverId: 'schema-test-server',
      logPath: join(tmpdir(), 'stdio-test.log')
    }, db, stdin, stdout)

    await bridge.start()

    // Simulate a tools/list request over the stdio transport and verify the
    // response contains the forwarded inputSchema.
    const requestId = 1
    const listRequest = JSON.stringify({
      jsonrpc: '2.0',
      id: requestId,
      method: 'tools/list',
      params: {}
    })

    const responseText = await new Promise<string>((resolve) => {
      let buf = ''
      stdout.on('data', (chunk: Buffer) => {
        buf += chunk.toString()
        // Each JSON-RPC message is terminated by \n\n in MCP stdio transport
        if (buf.includes('\n\n') || buf.includes('"result"')) {
          resolve(buf)
        }
      })
      stdin.write(listRequest + '\n')
    })

    const response = JSON.parse(responseText.trim().split('\n').find(l => l.startsWith('{')) ?? '{}')
    const tools: Array<{ name: string; inputSchema: unknown }> = response?.result?.tools ?? []
    const readFileTool = tools.find((t) => t.name === 'read_file')

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
      // Give initialize a moment then send the call
      setTimeout(() => stdin.write(callRequest + '\n'), 50)
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
