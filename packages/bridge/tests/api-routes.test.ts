import { describe, it, expect, afterAll } from 'vitest'
import Fastify from 'fastify'
import { existsSync, unlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import * as http from 'http'
import { openDb, insertToolCall } from '../src/db.js'
import { EventBus } from '../src/event-bus.js'
import { registerApiRoutes } from '../src/api-routes.js'

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
