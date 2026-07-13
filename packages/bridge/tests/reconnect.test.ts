import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { openDb, upsertKnownServer, listKnownServers } from '../src/db.js'
import { ActiveRegistry } from '../src/registry.js'
import { EventBus } from '../src/event-bus.js'
import { reconnectKnownServers } from '../src/reconnect.js'

vi.mock('../src/process-scanner.js', () => ({
  findBridgePort: vi.fn(),
  readPortFromConfig: vi.fn().mockResolvedValue(null)
}))

import { findBridgePort, readPortFromConfig } from '../src/process-scanner.js'

function makeDb() {
  return openDb(join(tmpdir(), `mcpinv-reconnect-${randomUUID()}.db`))
}

describe('reconnectKnownServers', () => {
  let db: ReturnType<typeof makeDb>
  let registry: ActiveRegistry
  let eventBus: EventBus

  beforeEach(() => {
    db = makeDb()
    registry = new ActiveRegistry()
    eventBus = new EventBus()
    vi.clearAllMocks()
  })

  afterEach(() => db.close())

  it('skips servers already in registry', async () => {
    upsertKnownServer(db, 'active-srv')
    registry.register('active-srv', 3001)
    vi.mocked(findBridgePort).mockResolvedValue(3001)

    await reconnectKnownServers(db, registry, eventBus)

    expect(findBridgePort).not.toHaveBeenCalled()
  })

  it('registers server when findBridgePort returns a port', async () => {
    upsertKnownServer(db, 'orphan-srv')
    vi.mocked(findBridgePort).mockResolvedValue(3042)

    await reconnectKnownServers(db, registry, eventBus)

    expect(registry.get('orphan-srv')).toMatchObject({ server_id: 'orphan-srv', port: 3042 })
  })

  it('updates last_port in DB when port found', async () => {
    upsertKnownServer(db, 'orphan-srv')
    vi.mocked(findBridgePort).mockResolvedValue(3007)

    await reconnectKnownServers(db, registry, eventBus)

    const known = listKnownServers(db)
    expect(known.find(s => s.id === 'orphan-srv')?.last_port).toBe(3007)
  })

  it('emits server_up event when reconnected', async () => {
    upsertKnownServer(db, 'orphan-srv')
    vi.mocked(findBridgePort).mockResolvedValue(3001)
    const events: unknown[] = []
    eventBus.on_event(e => events.push(e))

    await reconnectKnownServers(db, registry, eventBus)

    expect(events).toContainEqual(
      expect.objectContaining({ type: 'server_up', data: expect.objectContaining({ server_id: 'orphan-srv' }) })
    )
  })

  it('does not register server when findBridgePort returns null (stage 4)', async () => {
    upsertKnownServer(db, 'dead-srv')
    vi.mocked(findBridgePort).mockResolvedValue(null)

    await reconnectKnownServers(db, registry, eventBus)

    expect(registry.get('dead-srv')).toBeUndefined()
  })

  it('continues to next server when one fails', async () => {
    upsertKnownServer(db, 'srv-a')
    upsertKnownServer(db, 'srv-b')
    vi.mocked(findBridgePort)
      .mockRejectedValueOnce(new Error('unexpected'))  // srv-a throws
      .mockResolvedValueOnce(3002)                      // srv-b found

    await reconnectKnownServers(db, registry, eventBus)

    expect(registry.get('srv-b')).toMatchObject({ port: 3002 })
    // srv-a: not registered (error was caught), no throw propagated
    expect(registry.get('srv-a')).toBeUndefined()
  })

  it('includes last_port and derived port as candidates', async () => {
    upsertKnownServer(db, 'srv-x')
    // Set last_port directly in DB
    db.prepare('UPDATE known_servers SET last_port = 3099 WHERE id = ?').run('srv-x')
    vi.mocked(findBridgePort).mockResolvedValue(null)

    await reconnectKnownServers(db, registry, eventBus)

    // Should have been called with 3099 (last_port) as a candidate
    expect(findBridgePort).toHaveBeenCalledWith(
      expect.arrayContaining([3099]),
      expect.any(Number)
    )
  })
})
