import type { FastifyInstance } from 'fastify'
import type Database from 'better-sqlite3'
import type { EventBus, CockpitEvent } from './event-bus.js'
import { listKnownServers, upsertKnownServer } from './db.js'
import { ActiveRegistry } from './registry.js'

const startTime = Date.now()

export async function registerApiRoutes(
  fastify: FastifyInstance,
  db: Database.Database,
  eventBus: EventBus,
  registryOrServerId: ActiveRegistry | string,
  cliBin?: string
): Promise<void> {
  const isRegistry = registryOrServerId instanceof ActiveRegistry
  const legacyServerId = isRegistry ? null : registryOrServerId
  const registry = isRegistry ? registryOrServerId : null

  fastify.get('/api/servers', async () => {
    if (registry) {
      const known = listKnownServers(db)
      const activeMap = new Map(registry.getAll().map(e => [e.server_id, e]))

      const todayStart = new Date()
      todayStart.setUTCHours(0, 0, 0, 0)
      const todayStartMs = todayStart.getTime()
      const todayRows = db.prepare(
        'SELECT server_id, COUNT(*) AS calls FROM tool_calls WHERE ts >= ? GROUP BY server_id'
      ).all(todayStartMs) as { server_id: string; calls: number }[]
      const todayMap = new Map(todayRows.map(r => [r.server_id, r.calls]))

      return known.map(k => {
        const entry = activeMap.get(k.id)
        return entry
          ? { id: k.id, status: 'running', uptime_ms: Date.now() - entry.started_at, restart_count: 0, last_error: null, today_calls: todayMap.get(k.id) ?? 0 }
          : { id: k.id, status: 'stopped', uptime_ms: null, restart_count: 0, last_error: null, today_calls: todayMap.get(k.id) ?? 0 }
      })
    }
    return [{ id: legacyServerId, status: 'running', uptime_ms: Date.now() - startTime, restart_count: 0, last_error: null, today_calls: 0 }]
  })

  if (registry) {
    fastify.post<{ Body: { server_id: string; port: number; pid?: number } }>('/api/register', async (req) => {
      upsertKnownServer(db, req.body.server_id)
      registry.register(req.body.server_id, req.body.port, req.body.pid)
      eventBus.emit_event({ type: 'server_up', data: { ts: Date.now(), server_id: req.body.server_id } })
      return { ok: true }
    })

    fastify.delete<{ Params: { id: string } }>('/api/register/:id', async (req) => {
      registry.unregister(req.params.id)
      eventBus.emit_event({ type: 'server_down', data: { ts: Date.now(), server_id: req.params.id } })
      return { ok: true }
    })

    fastify.post<{ Params: { id: string } }>('/api/servers/:id/start', async (req, reply) => {
      if (!cliBin) {
        return reply.code(501).send({ error: 'spawn_not_configured' })
      }
      const addr = fastify.server.address() as { port: number } | null
      const cockpitOrigin = `http://localhost:${addr?.port ?? 3000}`
      const knownServers = listKnownServers(db)
      const serverIndex = knownServers.findIndex(s => s.id === req.params.id)
      const bridgePort = 3001 + (serverIndex >= 0 ? serverIndex : 0)
      const { spawn } = await import('child_process')
      const child = spawn(process.execPath, [
        cliBin, 'serve', req.params.id,
        '--port', String(bridgePort),
        '--cockpit-url', cockpitOrigin
      ], {
        detached: true,
        stdio: 'ignore'
      })
      child.unref()
      return { ok: true, port: bridgePort }
    })

    fastify.post<{ Params: { id: string } }>('/api/servers/:id/stop', async (req, reply) => {
      const entry = registry.get(req.params.id)
      if (!entry?.pid) {
        return reply.code(404).send({ error: 'pid_unknown' })
      }
      try {
        process.kill(entry.pid, 'SIGTERM')
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ESRCH') throw err
      }
      return { ok: true }
    })
  }

  // Cache static prepared statements once per route registration
  const stmtSummary = db.prepare(`
    SELECT COUNT(*)           AS total_calls,
           SUM(input_tokens)  AS total_input_tokens,
           SUM(output_tokens) AS total_output_tokens
    FROM tool_calls
  `)
  const stmtTopTool = db.prepare(`
    SELECT tool_name AS name, COUNT(*) AS calls
    FROM tool_calls
    GROUP BY tool_name
    ORDER BY calls DESC
    LIMIT 1
  `)
  const stmtDaily = db.prepare(`
    SELECT date(ts / 1000, 'unixepoch') AS date,
           COUNT(*)                     AS calls,
           SUM(input_tokens)            AS input_tokens
    FROM tool_calls
    WHERE ts > ?
    GROUP BY date
    ORDER BY date
  `)

  fastify.get('/api/calls', async (req) => {
    const q = req.query as Record<string, string>
    const limit = parseInt(q['limit'] ?? '100', 10) || 100
    const clauses: string[] = []
    const params: unknown[] = []
    if (q['server'])              { clauses.push('server_id = ?'); params.push(q['server']) }
    if (q['status'] === 'ok')    { clauses.push('success = 1') }
    if (q['status'] === 'error') { clauses.push('success = 0') }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    params.push(limit)
    return db.prepare(
      `SELECT id, ts, server_id, tool_name, args_hash, duration_ms, input_tokens, output_tokens, success, error_msg FROM tool_calls ${where} ORDER BY ts DESC LIMIT ?`
    ).all(...params)
  })

  fastify.get('/api/tokens/summary', async () => {
    const totals = stmtSummary.get() as Record<string, unknown>
    const top = stmtTopTool.get() ?? null
    return { ...totals, top_tool: top }
  })

  fastify.get('/api/tokens/daily', async (req) => {
    const q = req.query as Record<string, string>
    const days = parseInt(q['days'] ?? '14', 10) || 14
    const since = Date.now() - days * 86_400_000
    return stmtDaily.all(since)
  })

  fastify.get('/api/events', (req, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection:      'keep-alive'
    })
    reply.raw.write(':\n\n')

    const listener = (event: CockpitEvent) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
    }
    eventBus.on_event(listener)

    const heartbeat = setInterval(() => reply.raw.write(':\n\n'), 15_000)
    req.raw.on('close', () => {
      clearInterval(heartbeat)
      eventBus.off_event(listener)
    })

    return reply
  })
}
