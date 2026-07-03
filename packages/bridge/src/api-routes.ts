import type { FastifyInstance } from 'fastify'
import type Database from 'better-sqlite3'
import type { EventBus, CockpitEvent } from './event-bus.js'

const startTime = Date.now()

export async function registerApiRoutes(
  fastify: FastifyInstance,
  db: Database.Database,
  eventBus: EventBus,
  serverId: string
): Promise<void> {

  fastify.get('/api/servers', async () => [{
    id: serverId,
    status: 'running',
    uptime_ms: Date.now() - startTime,
    restart_count: 0,
    last_error: null
  }])

  fastify.get('/api/calls', async (req) => {
    const q = req.query as Record<string, string>
    const limit = parseInt(q['limit'] ?? '100', 10)
    const clauses: string[] = []
    const params: unknown[] = []
    if (q['server'])              { clauses.push('server_id = ?'); params.push(q['server']) }
    if (q['status'] === 'ok')    { clauses.push('success = 1') }
    if (q['status'] === 'error') { clauses.push('success = 0') }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    params.push(limit)
    return db.prepare(
      `SELECT * FROM tool_calls ${where} ORDER BY ts DESC LIMIT ?`
    ).all(...params)
  })

  fastify.get('/api/tokens/summary', async () => {
    const totals = db.prepare(`
      SELECT COUNT(*)           AS total_calls,
             SUM(input_tokens)  AS total_input_tokens,
             SUM(output_tokens) AS total_output_tokens
      FROM tool_calls
    `).get() as Record<string, unknown>
    const top = db.prepare(`
      SELECT tool_name AS name, COUNT(*) AS calls
      FROM tool_calls
      GROUP BY tool_name
      ORDER BY calls DESC
      LIMIT 1
    `).get() ?? null
    return { ...totals, top_tool: top }
  })

  fastify.get('/api/tokens/daily', async (req) => {
    const q = req.query as Record<string, string>
    const days = parseInt(q['days'] ?? '14', 10)
    const since = Date.now() - days * 86_400_000
    return db.prepare(`
      SELECT date(ts / 1000, 'unixepoch') AS date,
             COUNT(*)                     AS calls,
             SUM(input_tokens)            AS input_tokens
      FROM tool_calls
      WHERE ts > ?
      GROUP BY date
      ORDER BY date
    `).all(since)
  })

  fastify.get('/api/events', (req, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection:      'keep-alive'
    })
    // Initial keepalive comment to establish the connection
    reply.raw.write(':\n\n')

    const listener = (event: CockpitEvent) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
    }
    eventBus.on_event(listener)
    req.raw.on('close', () => eventBus.off_event(listener))

    return reply
  })
}
