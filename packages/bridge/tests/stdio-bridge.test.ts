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
