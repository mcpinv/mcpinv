import { describe, it, expect, afterAll, vi } from 'vitest'

vi.mock('child_process', () => ({
  spawn: vi.fn().mockReturnValue({ pid: 9999, unref: vi.fn() })
}))
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

describe('POST /api/servers/:id/start', () => {
  const paths: string[] = []

  async function buildCockpitAppWithCliBin(cliBin?: string, registry = new ActiveRegistry()) {
    const p = join(tmpdir(), `mcpinv-test-${randomUUID()}.db`)
    paths.push(p)
    const db = openDb(p)
    openDbs.push(db)
    const bus = new EventBus()
    const a = Fastify()
    await registerApiRoutes(a, db, bus, registry, cliBin)
    await a.listen({ port: 0, host: '127.0.0.1' })
    return { app: a, db, bus, registry }
  }

  afterAll(() => paths.forEach(p => { try { unlinkSync(p) } catch { /* ignore */ } }))

  it('returns ok:true and spawns bridge when cliBin is configured', async () => {
    const { spawn } = await import('child_process')
    const { app } = await buildCockpitAppWithCliBin('/usr/bin/mcpinv')
    const res = await app.inject({ method: 'POST', url: '/api/servers/my-server/start' })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ ok: true })
    expect(vi.mocked(spawn)).toHaveBeenCalledWith(
      expect.any(String),
      ['/usr/bin/mcpinv', 'serve', 'my-server', '--cockpit-url', expect.stringContaining('http://')],
      expect.objectContaining({ detached: true, stdio: 'ignore' })
    )
    await app.close()
  })

  it('returns 501 when cliBin is not configured', async () => {
    const { app } = await buildCockpitAppWithCliBin(undefined)
    const res = await app.inject({ method: 'POST', url: '/api/servers/my-server/start' })
    expect(res.statusCode).toBe(501)
    await app.close()
  })
})

describe('POST /api/servers/:id/stop', () => {
  const paths: string[] = []

  async function buildCockpitAppForStop(registry = new ActiveRegistry()) {
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

  it('sends SIGTERM to stored PID', async () => {
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
    const registry = new ActiveRegistry()
    registry.register('my-server', 3001, 5678)
    const { app } = await buildCockpitAppForStop(registry)
    const res = await app.inject({ method: 'POST', url: '/api/servers/my-server/stop' })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ ok: true })
    expect(killSpy).toHaveBeenCalledWith(5678, 'SIGTERM')
    killSpy.mockRestore()
    await app.close()
  })

  it('returns 404 when server not in registry', async () => {
    const { app } = await buildCockpitAppForStop()
    const res = await app.inject({ method: 'POST', url: '/api/servers/unknown-server/stop' })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('returns ok:true even when process already dead (ESRCH)', async () => {
    const err = Object.assign(new Error('No such process'), { code: 'ESRCH' })
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => { throw err })
    const registry = new ActiveRegistry()
    registry.register('dying-server', 3002, 9999)
    const { app } = await buildCockpitAppForStop(registry)
    const res = await app.inject({ method: 'POST', url: '/api/servers/dying-server/stop' })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ ok: true })
    killSpy.mockRestore()
    await app.close()
  })
})

describe('GET /api/servers — today_calls', () => {
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

  it('returns today_calls count for each server', async () => {
    const { app, db } = await buildCockpitApp()
    upsertKnownServer(db, 'srv-a')
    insertToolCall(db, { ts: Date.now(), server_id: 'srv-a', tool_name: 't', args_hash: '1', duration_ms: 1, input_tokens: null, output_tokens: null, success: 1, error_msg: null })
    insertToolCall(db, { ts: Date.now(), server_id: 'srv-a', tool_name: 't', args_hash: '2', duration_ms: 1, input_tokens: null, output_tokens: null, success: 1, error_msg: null })
    insertToolCall(db, { ts: Date.now(), server_id: 'srv-a', tool_name: 't', args_hash: '3', duration_ms: 1, input_tokens: null, output_tokens: null, success: 1, error_msg: null })
    // ts=0 is epoch (not today)
    insertToolCall(db, { ts: 0, server_id: 'srv-a', tool_name: 't', args_hash: '4', duration_ms: 1, input_tokens: null, output_tokens: null, success: 1, error_msg: null })
    const res = await app.inject({ method: 'GET', url: '/api/servers' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Array<{ id: string; today_calls: number }>
    const srv = body.find(s => s.id === 'srv-a')
    expect(srv?.today_calls).toBe(3)
    await app.close()
  })

  it('returns 0 today_calls when no calls today', async () => {
    const { app, db } = await buildCockpitApp()
    upsertKnownServer(db, 'srv-b')
    const res = await app.inject({ method: 'GET', url: '/api/servers' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as Array<{ id: string; today_calls: number }>
    const srv = body.find(s => s.id === 'srv-b')
    expect(srv?.today_calls).toBe(0)
    await app.close()
  })
})

describe('POST /api/register with pid', () => {
  const paths: string[] = []

  afterAll(() => paths.forEach(p => { try { unlinkSync(p) } catch { /* ignore */ } }))

  it('stores pid in registry', async () => {
    const p = join(tmpdir(), `mcpinv-test-${randomUUID()}.db`)
    paths.push(p)
    const db = openDb(p)
    openDbs.push(db)
    const registry = new ActiveRegistry()
    const bus = new EventBus()
    const a = Fastify()
    await registerApiRoutes(a, db, bus, registry)
    await a.ready()
    const res = await a.inject({
      method: 'POST', url: '/api/register',
      headers: { 'content-type': 'application/json' },
      payload: { server_id: 'srv', port: 3001, pid: 4242 }
    })
    expect(res.statusCode).toBe(200)
    expect(registry.get('srv')?.pid).toBe(4242)
    await a.close()
  })
})
