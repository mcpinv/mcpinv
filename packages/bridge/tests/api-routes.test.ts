import { describe, it, expect, afterAll } from 'vitest'
import Fastify from 'fastify'
import { existsSync, unlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import * as http from 'http'
import { openDb, insertToolCall, upsertKnownServer, listKnownServers } from '../src/db.js'
import { EventBus } from '../src/event-bus.js'
import { registerApiRoutes } from '../src/api-routes.js'
import { ActiveRegistry } from '../src/registry.js'

const openDbs: ReturnType<typeof openDb>[] = []
const tempDbs: string[] = []
afterAll(() => {
  for (const db of openDbs) { try { db.close() } catch { /* ignore */ } }
  for (const p of tempDbs) { if (existsSync(p)) unlinkSync(p) }
})

async function buildApp() {
  const dbPath = join(tmpdir(), `mcpinv-api-test-${randomUUID()}.db`)
  tempDbs.push(dbPath)
  const db = openDb(dbPath)
  openDbs.push(db)
  const bus = new EventBus()
  const app = Fastify()
  await registerApiRoutes(app, db, bus, 'test-server')
  await app.ready()
  return { app, db, bus }
}

describe('GET /api/servers', () => {
  it('returns server status array with running status', async () => {
    const { app } = await buildApp()
    const r = await app.inject({ method: 'GET', url: '/api/servers' })
    expect(r.statusCode).toBe(200)
    const body = JSON.parse(r.body) as unknown[]
    expect(Array.isArray(body)).toBe(true)
    const server = body[0] as Record<string, unknown>
    expect(server['id']).toBe('test-server')
    expect(server['status']).toBe('running')
    expect(typeof server['uptime_ms']).toBe('number')
  })
})

describe('GET /api/calls', () => {
  it('returns empty array when no calls', async () => {
    const { app } = await buildApp()
    const r = await app.inject({ method: 'GET', url: '/api/calls' })
    expect(r.statusCode).toBe(200)
    expect(JSON.parse(r.body)).toEqual([])
  })

  it('returns inserted calls ordered by ts desc', async () => {
    const { app, db } = await buildApp()
    insertToolCall(db, { ts: 1000, server_id: 'test-server', tool_name: 'tool_a',
      args_hash: 'x', duration_ms: 5, input_tokens: null, output_tokens: null, success: 1, error_msg: null })
    insertToolCall(db, { ts: 2000, server_id: 'test-server', tool_name: 'tool_b',
      args_hash: 'y', duration_ms: 10, input_tokens: null, output_tokens: null, success: 1, error_msg: null })
    const r = await app.inject({ method: 'GET', url: '/api/calls?limit=10' })
    const body = JSON.parse(r.body) as Array<{ tool_name: string }>
    expect(body[0].tool_name).toBe('tool_b')
  })

  it('filters by status=error', async () => {
    const { app, db } = await buildApp()
    insertToolCall(db, { ts: Date.now(), server_id: 'test-server', tool_name: 'ok_tool',
      args_hash: 'a', duration_ms: 1, input_tokens: null, output_tokens: null, success: 1, error_msg: null })
    insertToolCall(db, { ts: Date.now(), server_id: 'test-server', tool_name: 'fail_tool',
      args_hash: 'b', duration_ms: 1, input_tokens: null, output_tokens: null, success: 0, error_msg: 'oops' })
    const r = await app.inject({ method: 'GET', url: '/api/calls?status=error' })
    const body = JSON.parse(r.body) as Array<{ tool_name: string }>
    expect(body.every(c => c.tool_name === 'fail_tool')).toBe(true)
  })
})

describe('GET /api/tokens/summary', () => {
  it('returns summary object with total_calls', async () => {
    const { app } = await buildApp()
    const r = await app.inject({ method: 'GET', url: '/api/tokens/summary' })
    expect(r.statusCode).toBe(200)
    const body = JSON.parse(r.body) as Record<string, unknown>
    expect(typeof body['total_calls']).toBe('number')
  })
})

describe('GET /api/tokens/daily', () => {
  it('returns array of daily buckets', async () => {
    const { app } = await buildApp()
    const r = await app.inject({ method: 'GET', url: '/api/tokens/daily?days=7' })
    expect(r.statusCode).toBe(200)
    expect(Array.isArray(JSON.parse(r.body))).toBe(true)
  })
})

describe('GET /api/calls (filter tests)', () => {
  it('filters by status=ok', async () => {
    const { app, db } = await buildApp()
    insertToolCall(db, { ts: Date.now(), server_id: 'test-server', tool_name: 'ok_tool',
      args_hash: 'c', duration_ms: 1, input_tokens: null, output_tokens: null, success: 1, error_msg: null })
    insertToolCall(db, { ts: Date.now(), server_id: 'test-server', tool_name: 'fail_tool',
      args_hash: 'd', duration_ms: 1, input_tokens: null, output_tokens: null, success: 0, error_msg: 'boom' })
    const r = await app.inject({ method: 'GET', url: '/api/calls?status=ok' })
    const body = JSON.parse(r.body) as Array<{ tool_name: string }>
    expect(body.every(c => c.tool_name === 'ok_tool')).toBe(true)
  })

  it('filters by server', async () => {
    const { app, db } = await buildApp()
    insertToolCall(db, { ts: Date.now(), server_id: 'server-a', tool_name: 'tool_a',
      args_hash: 'e', duration_ms: 1, input_tokens: null, output_tokens: null, success: 1, error_msg: null })
    insertToolCall(db, { ts: Date.now(), server_id: 'server-b', tool_name: 'tool_b',
      args_hash: 'f', duration_ms: 1, input_tokens: null, output_tokens: null, success: 1, error_msg: null })
    const r = await app.inject({ method: 'GET', url: '/api/calls?server=server-a' })
    const body = JSON.parse(r.body) as Array<{ server_id: string }>
    expect(body.every(c => c.server_id === 'server-a')).toBe(true)
  })
})

describe('GET /api/events', () => {
  it('responds with text/event-stream content type', async () => {
    const { app } = await buildApp()
    await app.listen({ port: 0, host: '127.0.0.1' })
    const addr = app.server.address() as { port: number }
    try {
      const contentType = await new Promise<string>((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${addr.port}/api/events`, (res) => {
          resolve(res.headers['content-type'] ?? '')
          res.destroy()
          req.destroy()
        })
        req.on('error', reject)
      })
      expect(contentType).toContain('text/event-stream')
    } finally {
      await app.close()
    }
  })
})

describe('CockpitServer API (registry mode)', () => {
  const paths: string[] = []

  async function buildCockpitApp(registry = new ActiveRegistry()) {
    const p = join(tmpdir(), `mcpinv-test-${randomUUID()}.db`)
    paths.push(p)
    const db = openDb(p)
    openDbs.push(db)
    const bus = new EventBus()
    const a = Fastify()
    await registerApiRoutes(a, db, bus, registry)
    await a.ready()
    return { app: a, db, bus, registry }
  }

  afterAll(() => paths.forEach(p => { try { unlinkSync(p) } catch { /* ignore */ } }))

  it('GET /api/servers returns known servers as stopped when registry is empty', async () => {
    const { app, db } = await buildCockpitApp()
    upsertKnownServer(db, 'mira-local')
    const res = await app.inject({ method: 'GET', url: '/api/servers' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body).toHaveLength(1)
    expect(body[0].id).toBe('mira-local')
    expect(body[0].status).toBe('stopped')
    await app.close()
  })

  it('GET /api/servers shows running when server is in registry', async () => {
    const registry = new ActiveRegistry()
    registry.register('mira-local', 3001)
    const { app, db } = await buildCockpitApp(registry)
    upsertKnownServer(db, 'mira-local')
    const res = await app.inject({ method: 'GET', url: '/api/servers' })
    const body = JSON.parse(res.body)
    expect(body[0].status).toBe('running')
    await app.close()
  })

  it('POST /api/register adds server to registry and known_servers', async () => {
    const registry = new ActiveRegistry()
    const { app, db } = await buildCockpitApp(registry)
    const res = await app.inject({
      method: 'POST', url: '/api/register',
      headers: { 'content-type': 'application/json' },
      payload: { server_id: 'mira-local', port: 3001 }
    })
    expect(res.statusCode).toBe(200)
    expect(registry.get('mira-local')?.port).toBe(3001)
    const known = listKnownServers(db)
    expect(known.some(s => s.id === 'mira-local')).toBe(true)
    await app.close()
  })

  it('DELETE /api/register/:id removes server from registry', async () => {
    const registry = new ActiveRegistry()
    registry.register('mira-local', 3001)
    const { app } = await buildCockpitApp(registry)
    const res = await app.inject({ method: 'DELETE', url: '/api/register/mira-local' })
    expect(res.statusCode).toBe(200)
    expect(registry.get('mira-local')).toBeUndefined()
    await app.close()
  })
})
