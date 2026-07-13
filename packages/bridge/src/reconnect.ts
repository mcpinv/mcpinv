import type Database from 'better-sqlite3'
import { listKnownServers, updateLastPort } from './db.js'
import type { ActiveRegistry } from './registry.js'
import type { EventBus } from './event-bus.js'
import { findBridgePort, readPortFromConfig } from './process-scanner.js'

const PROBE_TIMEOUT_MS = 500
const DERIVED_BASE_PORT = 3001

export async function reconnectKnownServers(
  db: Database.Database,
  registry: ActiveRegistry,
  eventBus: EventBus
): Promise<void> {
  const known = listKnownServers(db)
  const activeIds = new Set(registry.getAll().map(e => e.server_id))

  for (let i = 0; i < known.length; i++) {
    const server = known[i]
    if (activeIds.has(server.id)) continue

    try {
      const candidates: number[] = []

      // Stage 1: last_port from SQLite
      if (server.last_port != null) candidates.push(server.last_port)

      // Stage 2: deterministic derived port (same formula as Cockpit Start button)
      const derived = DERIVED_BASE_PORT + i
      if (!candidates.includes(derived)) candidates.push(derived)

      // Stage 3a: config --port hint
      const configPort = await readPortFromConfig(server.id)
      if (configPort != null && !candidates.includes(configPort)) candidates.push(configPort)

      // Stage 3b: OS scan included inside findBridgePort as fallback
      const port = await findBridgePort(candidates, PROBE_TIMEOUT_MS)

      if (port != null) {
        updateLastPort(db, server.id, port)
        registry.register(server.id, port)
        eventBus.emit_event({
          type: 'server_up',
          data: { ts: Date.now(), server_id: server.id }
        })
      }
      // Stage 4: not found — server stays stopped, no event emitted
    } catch {
      // Per-server errors are non-fatal; continue to next
    }
  }
}
