import { describe, it, expect, afterEach } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { CockpitServer } from '../src/cockpit-server.js'

const dbPath = () => join(tmpdir(), `mcpinv-test-${randomUUID()}.db`)

describe('CockpitServer', () => {
  let server: CockpitServer | null = null

  afterEach(async () => { await server?.stop(); server = null })

  it('starts and responds to GET /api/servers', async () => {
    server = new CockpitServer({ port: 0, host: '127.0.0.1', dbPath: dbPath() })
    await server.start()
    const port = (server as any).fastify.server.address().port
    const res = await fetch(`http://127.0.0.1:${port}/api/servers`)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(Array.isArray(data)).toBe(true)
  })

  it('exposes registry publicly', async () => {
    server = new CockpitServer({ port: 0, host: '127.0.0.1', dbPath: dbPath() })
    await server.start()
    expect(server.registry).toBeDefined()
    server.registry.register('mira-local', 3001)
    expect(server.registry.get('mira-local')?.port).toBe(3001)
  })

  it('stop is idempotent', async () => {
    server = new CockpitServer({ port: 0, host: '127.0.0.1', dbPath: dbPath() })
    await server.start()
    await server.stop()
    await expect(server.stop()).resolves.not.toThrow()
    server = null
  })
})
