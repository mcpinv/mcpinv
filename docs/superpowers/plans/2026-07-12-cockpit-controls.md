# Cockpit Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Start/Stop buttons to the Cockpit Servers panel plus a "Today's Calls" column, enabling the Cockpit to spawn and kill bridge processes without leaving the UI.

**Architecture:** Three layers:
1. **Registry PID tracking** — `ActiveEntry` gains `pid?: number`; `POST /api/register` accepts `pid` from self-registering bridges; `server.ts` sends `process.pid` when registering.
2. **Start/Stop API** — `POST /api/servers/:id/start` spawns `mcpinv serve <id>` detached (using the CLI binary path passed in `CockpitServerOptions.cliBin`); `POST /api/servers/:id/stop` sends SIGTERM to the stored PID.
3. **UI** — Servers panel gains an Actions column (Start/Stop button based on status) and a Today's Calls column (from a per-server count injected into `GET /api/servers`).

**Tech Stack:** Node.js `child_process.spawn` (detached), existing `ActiveRegistry`, Fastify, React 18, existing inline styles.

## Global Constraints

- TypeScript ESM (`"type": "module"`)
- No new npm dependencies
- All code and comments in English
- TDD: tests written before implementation
- Spawned bridge process: `detached: true`, `stdio: 'ignore'`, `.unref()` — must survive Cockpit crash
- Start/Stop endpoints are no-ops (return `{ ok: true }`) if cockpit is not configured for spawn (no `cliBin`)
- Stop is non-fatal if PID is unknown or process already dead (catch ESRCH)
- Today's calls = tool_calls rows where `ts >= midnight UTC today` AND `server_id = ?`
- UI: no external component libraries — inline styles only, same pattern as existing panels
- WCAG 2.1 AA: buttons have accessible labels

---

## File Structure

```
packages/bridge/src/
  registry.ts          MODIFY — add pid?: number to ActiveEntry; update register() signature
  types.ts             MODIFY — add cliBin?: string to CockpitServerOptions
  api-routes.ts        MODIFY — POST /api/servers/:id/start, POST /api/servers/:id/stop;
                                 update POST /api/register to accept pid;
                                 add today_calls to GET /api/servers response
  server.ts            MODIFY — send pid: process.pid in cockpit registration fetch
  cockpit-server.ts    MODIFY — pass cliBin to registerApiRoutes

packages/bridge/tests/
  registry.test.ts     MODIFY — pid tests
  api-routes.test.ts   MODIFY — start/stop endpoint tests, today_calls tests

packages/cli/src/commands/
  cockpit.ts           MODIFY — pass cliBin: process.argv[1] to CockpitServer

packages/ui/src/api/
  client.ts            MODIFY — add today_calls to ServerStatus; add startServer, stopServer

packages/ui/src/panels/servers/
  index.tsx            MODIFY — Actions column (Start/Stop button); Today's Calls column
```

---

### Task 1: PID tracking + Start/Stop API endpoints

**Files:**
- Modify: `packages/bridge/src/registry.ts`
- Modify: `packages/bridge/src/types.ts`
- Modify: `packages/bridge/src/api-routes.ts`
- Modify: `packages/bridge/src/server.ts`
- Modify: `packages/bridge/src/cockpit-server.ts`
- Modify: `packages/cli/src/commands/cockpit.ts`
- Modify: `packages/bridge/tests/registry.test.ts`
- Modify: `packages/bridge/tests/api-routes.test.ts`

**Interfaces:**
- Consumes: existing `ActiveRegistry`, `registerApiRoutes`, `CockpitServerOptions`, `BridgeServer`
- Produces:
  ```typescript
  // registry.ts
  interface ActiveEntry {
    server_id: string
    port: number
    started_at: number
    pid?: number  // set when bridge registers or when Cockpit spawns
  }
  class ActiveRegistry {
    register(server_id: string, port: number, pid?: number): void
    // getAll(), get(), unregister() unchanged
  }

  // types.ts — CockpitServerOptions gains:
  cliBin?: string   // absolute path to the mcpinv CLI script; enables Start button

  // api-routes.ts — new routes:
  POST /api/servers/:id/start  → { ok: true } | { error: string }
  POST /api/servers/:id/stop   → { ok: true } | { error: string }
  // POST /api/register body gains: pid?: number
  ```

- [ ] **Step 1: Write failing tests — registry**

Read `packages/bridge/tests/registry.test.ts` first to see existing test style.

Add to `packages/bridge/tests/registry.test.ts`:

```typescript
describe('ActiveRegistry — pid tracking', () => {
  it('stores pid when provided', () => {
    const reg = new ActiveRegistry()
    reg.register('srv', 3001, 1234)
    expect(reg.get('srv')?.pid).toBe(1234)
  })

  it('stores undefined pid when not provided', () => {
    const reg = new ActiveRegistry()
    reg.register('srv', 3001)
    expect(reg.get('srv')?.pid).toBeUndefined()
  })
})
```

- [ ] **Step 2: Write failing tests — api-routes start/stop**

Read `packages/bridge/tests/api-routes.test.ts` first to understand the test setup (Fastify instance creation, mock registry, mock db).

Add to `packages/bridge/tests/api-routes.test.ts`:

```typescript
// At the top of the file, import spawn mock:
// vi.mock('child_process', () => ({ spawn: vi.fn().mockReturnValue({ pid: 9999, unref: vi.fn() }) }))

describe('POST /api/servers/:id/start', () => {
  it('returns ok:true and spawns bridge when cliBin is configured', async () => {
    const { spawn } = await import('child_process')
    // Set up fastify with cliBin: '/usr/bin/mcpinv'
    // POST /api/servers/my-server/start
    // Expect spawn called with ['/usr/bin/mcpinv', ['serve', 'my-server', '--cockpit-url', ...]]
    // Expect response { ok: true }
    expect(vi.mocked(spawn)).toHaveBeenCalledWith(
      expect.any(String),  // process.execPath
      ['/usr/bin/mcpinv', 'serve', 'my-server', expect.stringContaining('--cockpit-url')],
      expect.objectContaining({ detached: true, stdio: 'ignore' })
    )
  })

  it('returns 501 when cliBin is not configured', async () => {
    // Set up fastify without cliBin
    // POST /api/servers/my-server/start
    // Expect 501 response
  })
})

describe('POST /api/servers/:id/stop', () => {
  it('sends SIGTERM to stored PID', async () => {
    // Register a server with pid: 5678
    // POST /api/servers/my-server/stop
    // Expect process.kill(5678, 'SIGTERM') was called
  })

  it('returns 404 when server not in registry or pid unknown', async () => {
    // POST /api/servers/unknown-server/stop
    // Expect 404 response
  })

  it('returns ok:true even when process already dead (ESRCH)', async () => {
    // Register server with pid that throws ESRCH on kill
    // Expect { ok: true } — not a 500
  })
})

describe('POST /api/register with pid', () => {
  it('stores pid in registry', async () => {
    // POST /api/register { server_id: 'srv', port: 3001, pid: 4242 }
    // Expect registry.get('srv').pid === 4242
  })
})
```

**Note:** The test setup for api-routes needs `vi.mock('child_process', ...)` AND `vi.spyOn(process, 'kill')` — add both at the top of the describe block or module level. Follow the existing mock pattern in the file.

- [ ] **Step 3: Run tests to verify they fail**

```powershell
cd packages/bridge; npm test -- tests/registry.test.ts tests/api-routes.test.ts
```
Expected: new tests FAIL

- [ ] **Step 4: Update registry.ts**

```typescript
export interface ActiveEntry {
  server_id: string
  port: number
  started_at: number
  pid?: number
}

export class ActiveRegistry {
  private readonly entries = new Map<string, ActiveEntry>()

  register(server_id: string, port: number, pid?: number): void {
    this.entries.set(server_id, { server_id, port, started_at: Date.now(), pid })
  }

  unregister(server_id: string): void { this.entries.delete(server_id) }
  getAll(): ActiveEntry[] { return Array.from(this.entries.values()) }
  get(server_id: string): ActiveEntry | undefined { return this.entries.get(server_id) }
}
```

- [ ] **Step 5: Update types.ts**

Add `cliBin?: string` to `CockpitServerOptions`:

```typescript
export interface CockpitServerOptions {
  port: number
  host: string
  dbPath?: string
  cliBin?: string  // path to mcpinv CLI script; enables Cockpit-initiated bridge spawn
}
```

- [ ] **Step 6: Update api-routes.ts**

Add three changes:

**1. Update `registerApiRoutes` signature** — add `cliBin?: string` as last parameter:

```typescript
export async function registerApiRoutes(
  fastify: FastifyInstance,
  db: Database.Database,
  eventBus: EventBus,
  registryOrServerId: ActiveRegistry | string,
  cliBin?: string
): Promise<void>
```

**2. Update `POST /api/register`** — accept and store `pid`:

```typescript
fastify.post<{ Body: { server_id: string; port: number; pid?: number } }>('/api/register', async (req) => {
  upsertKnownServer(db, req.body.server_id)
  registry.register(req.body.server_id, req.body.port, req.body.pid)
  eventBus.emit_event({ type: 'server_up', data: { ts: Date.now(), server_id: req.body.server_id } })
  return { ok: true }
})
```

**3. Add start/stop routes** — add after the delete route, still inside `if (registry)` block:

```typescript
const cockpitOrigin = `http://localhost:${fastify.server.address ? (fastify.server.address() as { port: number }).port : 3000}`

fastify.post<{ Params: { id: string } }>('/api/servers/:id/start', async (_req, reply) => {
  if (!cliBin) {
    return reply.code(501).send({ error: 'spawn_not_configured' })
  }
  const { spawn } = await import('child_process')
  const child = spawn(process.execPath, [cliBin, 'serve', _req.params.id, '--cockpit-url', cockpitOrigin], {
    detached: true,
    stdio: 'ignore'
  })
  child.unref()
  return { ok: true }
})

fastify.post<{ Params: { id: string } }>('/api/servers/:id/stop', async (req, reply) => {
  const entry = registry.get(req.params.id)
  if (!entry?.pid) {
    return reply.code(404).send({ error: 'pid_unknown' })
  }
  try {
    process.kill(entry.pid, 'SIGTERM')
  } catch (err) {
    // ESRCH = process already dead — not an error
    if ((err as NodeJS.ErrnoException).code !== 'ESRCH') throw err
  }
  return { ok: true }
})
```

**Note on `cockpitOrigin`:** `fastify.server.address()` returns `null` before `listen()` is called. In tests, the Fastify instance is started before route registration — verify the timing in tests. If `address()` returns null, fall back to `'http://localhost:3000'`.

- [ ] **Step 7: Update server.ts**

In the cockpit registration `fetch`, add `pid: process.pid`:

```typescript
fetch(`${cockpitUrl}/api/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ server_id: this.options.serverId, port: this.options.port, pid: process.pid })
}).catch(() => {})
```

- [ ] **Step 8: Update cockpit-server.ts**

Pass `this.options.cliBin` to `registerApiRoutes`:

```typescript
await registerApiRoutes(this.fastify, this.db, this.eventBus, this.registry, this.options.cliBin)
```

- [ ] **Step 9: Update cockpit.ts**

Pass `cliBin: process.argv[1]` to `CockpitServer`:

```typescript
const server = new CockpitServer({
  port: opts.port,
  host: opts.host,
  dbPath: opts.db,
  cliBin: process.argv[1]
})
```

- [ ] **Step 10: Run tests to verify they pass**

```powershell
cd packages/bridge; npm test -- tests/registry.test.ts tests/api-routes.test.ts
```
Expected: all new tests PASS

- [ ] **Step 11: Run full bridge suite**

```powershell
cd packages/bridge; npm test
```
Expected: all tests PASS (62 existing + new)

- [ ] **Step 12: Commit**

```powershell
git add packages/bridge/src/registry.ts packages/bridge/src/types.ts packages/bridge/src/api-routes.ts packages/bridge/src/server.ts packages/bridge/src/cockpit-server.ts packages/cli/src/commands/cockpit.ts packages/bridge/tests/registry.test.ts packages/bridge/tests/api-routes.test.ts
git commit -m "feat: Cockpit start/stop API — PID tracking, detached spawn, SIGTERM stop"
```

---

### Task 2: Today's Calls in GET /api/servers

**Files:**
- Modify: `packages/bridge/src/api-routes.ts`
- Modify: `packages/ui/src/api/client.ts`
- Modify: `packages/bridge/tests/api-routes.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  // GET /api/servers response (hub mode) — each entry gains:
  today_calls: number  // count of tool_calls rows for this server since midnight UTC today

  // client.ts
  interface ServerStatus {
    // existing fields...
    today_calls: number
  }
  ```

- [ ] **Step 1: Write the failing test**

Add to `packages/bridge/tests/api-routes.test.ts`:

```typescript
describe('GET /api/servers — today_calls', () => {
  it('returns today_calls count for each server', async () => {
    // Insert a known server 'srv-a' into db
    // Insert 3 tool_calls for 'srv-a' with ts = Date.now() (today)
    // Insert 1 tool_call for 'srv-a' with ts = 0 (epoch — not today)
    // GET /api/servers
    // Expect response[0].today_calls === 3
  })

  it('returns 0 today_calls when no calls today', async () => {
    // Insert a known server 'srv-b' with no calls
    // GET /api/servers
    // Expect response[n].today_calls === 0
  })
})
```

Use the same in-memory SQLite (`openDb(':memory:')`) pattern already in the test file.

- [ ] **Step 2: Run to verify failure**

```powershell
cd packages/bridge; npm test -- tests/api-routes.test.ts
```
Expected: 2 new tests FAIL

- [ ] **Step 3: Implement today_calls in api-routes.ts**

In `registerApiRoutes`, in the `GET /api/servers` hub-mode handler, add a today query:

```typescript
fastify.get('/api/servers', async () => {
  if (registry) {
    const known = listKnownServers(db)
    const activeMap = new Map(registry.getAll().map(e => [e.server_id, e]))

    // Midnight UTC today
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
        ? {
            id: k.id,
            status: 'running',
            uptime_ms: Date.now() - entry.started_at,
            restart_count: 0,
            last_error: null,
            today_calls: todayMap.get(k.id) ?? 0
          }
        : {
            id: k.id,
            status: 'stopped',
            uptime_ms: null,
            restart_count: 0,
            last_error: null,
            today_calls: todayMap.get(k.id) ?? 0
          }
    })
  }
  // Legacy single-server mode — no today_calls
  return [{ id: legacyServerId, status: 'running', uptime_ms: Date.now() - startTime, restart_count: 0, last_error: null, today_calls: 0 }]
})
```

- [ ] **Step 4: Update client.ts**

Add `today_calls` to `ServerStatus`:

```typescript
export interface ServerStatus {
  id: string
  status: 'running' | 'stopped' | 'error'
  uptime_ms: number | null
  restart_count: number
  last_error: string | null
  today_calls: number
}
```

Also add `startServer` and `stopServer` API functions:

```typescript
export async function startServer(id: string): Promise<void> {
  const r = await fetch(`${BASE}/api/servers/${encodeURIComponent(id)}/start`, { method: 'POST' })
  if (!r.ok) throw new Error(`start ${id}: ${r.status}`)
}

export async function stopServer(id: string): Promise<void> {
  const r = await fetch(`${BASE}/api/servers/${encodeURIComponent(id)}/stop`, { method: 'POST' })
  if (!r.ok) throw new Error(`stop ${id}: ${r.status}`)
}
```

- [ ] **Step 5: Run tests**

```powershell
cd packages/bridge; npm test
```
Expected: all tests PASS

- [ ] **Step 6: Commit**

```powershell
git add packages/bridge/src/api-routes.ts packages/ui/src/api/client.ts packages/bridge/tests/api-routes.test.ts
git commit -m "feat: today_calls count in GET /api/servers; startServer/stopServer API client"
```

---

### Task 3: UI — Start/Stop buttons + Today's Calls column

**Files:**
- Modify: `packages/ui/src/panels/servers/index.tsx`

**Interfaces:**
- Consumes: `startServer`, `stopServer`, `today_calls` from Task 2
- Produces: Servers panel with two new columns — "Actions" (button) and "Today" (call count)

- [ ] **Step 1: Write the failing test**

There are no tests for the UI panel. Add a basic smoke test for the new elements.

Create `packages/ui/src/panels/servers/servers.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ServersPanel } from './index.js'
import * as client from '../../api/client.js'

vi.mock('../../api/client.js', () => ({
  getServers: vi.fn(),
  subscribeEvents: vi.fn(() => () => {}),
  startServer: vi.fn().mockResolvedValue(undefined),
  stopServer: vi.fn().mockResolvedValue(undefined)
}))

describe('ServersPanel', () => {
  beforeEach(() => {
    vi.mocked(client.getServers).mockResolvedValue([
      { id: 'my-server', status: 'stopped', uptime_ms: null, restart_count: 0, last_error: null, today_calls: 7 }
    ])
  })

  it('shows today_calls count', async () => {
    render(<ServersPanel />)
    expect(await screen.findByText('7')).toBeInTheDocument()
  })

  it('shows Start button for stopped server', async () => {
    render(<ServersPanel />)
    expect(await screen.findByRole('button', { name: /start/i })).toBeInTheDocument()
  })

  it('shows Stop button for running server', async () => {
    vi.mocked(client.getServers).mockResolvedValue([
      { id: 'my-server', status: 'running', uptime_ms: 5000, restart_count: 0, last_error: null, today_calls: 3 }
    ])
    render(<ServersPanel />)
    expect(await screen.findByRole('button', { name: /stop/i })).toBeInTheDocument()
  })

  it('calls startServer when Start button clicked', async () => {
    render(<ServersPanel />)
    fireEvent.click(await screen.findByRole('button', { name: /start/i }))
    await waitFor(() => expect(client.startServer).toHaveBeenCalledWith('my-server'))
  })

  it('calls stopServer when Stop button clicked', async () => {
    vi.mocked(client.getServers).mockResolvedValue([
      { id: 'running-srv', status: 'running', uptime_ms: 1000, restart_count: 0, last_error: null, today_calls: 0 }
    ])
    render(<ServersPanel />)
    fireEvent.click(await screen.findByRole('button', { name: /stop/i }))
    await waitFor(() => expect(client.stopServer).toHaveBeenCalledWith('running-srv'))
  })
})
```

Check `packages/ui/package.json` for `@testing-library/react` — if not present, add it (it is a dev dependency in typical Vite React setups). If missing, note this in the implementation.

- [ ] **Step 2: Run to verify failure**

```powershell
cd packages/ui; npm test -- src/panels/servers/servers.test.tsx
```
Expected: FAIL (file doesn't exist or `startServer` missing)

- [ ] **Step 3: Update ServersPanel**

Replace `packages/ui/src/panels/servers/index.tsx` with the updated version:

```tsx
import { useEffect, useState } from 'react'
import {
  getServers, startServer, stopServer, subscribeEvents,
  type ServerStatus
} from '../../api/client.js'
import type { Panel } from '../../registry.js'

export function ServersPanel() {
  const [servers, setServers]   = useState<ServerStatus[]>([])
  const [error, setError]       = useState<string | null>(null)
  const [loading, setLoading]   = useState<Record<string, boolean>>({})

  useEffect(() => {
    getServers().then(setServers).catch(e => setError((e as Error).message))
    return subscribeEvents(event => {
      const e = event as { type: string }
      if (['server_up', 'server_down', 'server_error'].includes(e.type)) {
        getServers().then(setServers).catch(() => {})
      }
    })
  }, [])

  const handleStart = async (id: string) => {
    setLoading(l => ({ ...l, [id]: true }))
    try {
      await startServer(id)
      // Bridge will register itself via SSE → re-fetch triggered by subscribeEvents
    } catch {
      getServers().then(setServers).catch(() => {})
    } finally {
      setLoading(l => ({ ...l, [id]: false }))
    }
  }

  const handleStop = async (id: string) => {
    setLoading(l => ({ ...l, [id]: true }))
    try {
      await stopServer(id)
    } catch {
      // ignore
    } finally {
      setLoading(l => ({ ...l, [id]: false }))
      getServers().then(setServers).catch(() => {})
    }
  }

  if (error)           return <p style={{ color: '#ef4444' }}>Failed to load: {error}</p>
  if (!servers.length) return <p style={{ color: '#6b7280' }}>No servers registered. Run: mcpinv import</p>

  return (
    <div>
      <h1 style={{ fontSize: 18, fontWeight: 600, marginBottom: 20 }}>Servers</h1>
      <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ color: '#6b7280', textAlign: 'left', borderBottom: '1px solid #1f2937' }}>
            <th style={{ paddingBottom: 8, paddingRight: 16 }}>Server</th>
            <th style={{ paddingBottom: 8, paddingRight: 16 }}>Status</th>
            <th style={{ paddingBottom: 8, paddingRight: 16 }}>Uptime</th>
            <th style={{ paddingBottom: 8, paddingRight: 16 }}>Today</th>
            <th style={{ paddingBottom: 8, paddingRight: 16 }}>Last Error</th>
            <th style={{ paddingBottom: 8 }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {servers.map(s => (
            <tr key={s.id} style={{ borderBottom: '1px solid #111827' }}>
              <td style={{ padding: '10px 16px 10px 0', fontFamily: 'monospace' }}>{s.id}</td>
              <td style={{ paddingRight: 16 }}>
                <span style={{
                  padding: '2px 8px', borderRadius: 4, fontSize: 11,
                  background: `${statusColor(s.status)}22`, color: statusColor(s.status)
                }}>{s.status}</span>
              </td>
              <td style={{ paddingRight: 16, color: '#9ca3af' }}>
                {s.uptime_ms != null ? formatUptime(s.uptime_ms) : '—'}
              </td>
              <td style={{ paddingRight: 16, color: '#9ca3af' }}>
                {s.today_calls}
              </td>
              <td style={{ color: '#ef4444', fontSize: 11, maxWidth: 200,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                paddingRight: 16 }}>
                {s.last_error ?? '—'}
              </td>
              <td>
                {s.status === 'running'
                  ? (
                    <button
                      aria-label={`Stop ${s.id}`}
                      disabled={loading[s.id]}
                      onClick={() => handleStop(s.id)}
                      style={{
                        padding: '3px 10px', borderRadius: 4, fontSize: 11,
                        cursor: loading[s.id] ? 'default' : 'pointer',
                        background: '#1f2937', color: '#ef4444',
                        border: '1px solid #374151', opacity: loading[s.id] ? 0.5 : 1
                      }}
                    >
                      Stop
                    </button>
                  )
                  : (
                    <button
                      aria-label={`Start ${s.id}`}
                      disabled={loading[s.id]}
                      onClick={() => handleStart(s.id)}
                      style={{
                        padding: '3px 10px', borderRadius: 4, fontSize: 11,
                        cursor: loading[s.id] ? 'default' : 'pointer',
                        background: '#064e3b', color: '#34d399',
                        border: '1px solid #065f46', opacity: loading[s.id] ? 0.5 : 1
                      }}
                    >
                      Start
                    </button>
                  )
                }
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function formatUptime(ms: number): string {
  if (ms < 60_000)    return `${Math.floor(ms / 1_000)}s`
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`
  return `${Math.floor(ms / 3_600_000)}h`
}

function statusColor(status: string): string {
  if (status === 'running') return '#10b981'
  if (status === 'error')   return '#ef4444'
  return '#6b7280'
}

export const panel: Panel = {
  id: 'servers',
  label: 'Servers',
  route: '/servers',
  component: ServersPanel,
  order: 1
}
```

**Note:** The existing `index.tsx` exported an anonymous `ServersPanel` function assigned to `panel.component`. This version exports `ServersPanel` by name (needed for tests) AND assigns it to `panel.component`. This is a non-breaking change for the registry.

- [ ] **Step 4: Check for @testing-library/react**

```powershell
cd packages/ui; cat package.json | Select-String "testing-library"
```

If not present, add it:
```powershell
cd packages/ui; npm install --save-dev @testing-library/react @testing-library/jest-dom jsdom
```

Then update `packages/ui/vitest.config.ts` (or `vite.config.ts`) to use `environment: 'jsdom'` and import `@testing-library/jest-dom` in setup. Check existing test config first — follow whatever pattern is already set up.

- [ ] **Step 5: Run tests to verify they pass**

```powershell
cd packages/ui; npm test -- src/panels/servers/servers.test.tsx
```
Expected: 5 tests PASS

- [ ] **Step 6: Run full UI test suite**

```powershell
cd packages/ui; npm test
```
Expected: all tests PASS

- [ ] **Step 7: Commit**

```powershell
git add packages/ui/src/panels/servers/index.tsx packages/ui/src/panels/servers/servers.test.tsx
git commit -m "feat: Cockpit Servers panel — Start/Stop buttons and Today's Calls column"
```

---

## Self-Review

**Spec coverage:**
- ✅ Start button spawns `mcpinv serve <id>` detached with `unref()` (Task 1)
- ✅ Stop button sends SIGTERM to PID (Task 1)
- ✅ ESRCH (already dead) is non-fatal for stop (Task 1)
- ✅ No cliBin → 501 (not a 500) (Task 1)
- ✅ Bridge sends `process.pid` on self-registration (Task 1)
- ✅ `today_calls` per server since midnight UTC (Task 2)
- ✅ `startServer` / `stopServer` in api client (Task 2)
- ✅ Start button on stopped servers, Stop on running (Task 3)
- ✅ Button disabled while in-flight (Task 3)
- ✅ WCAG: `aria-label` on buttons (Task 3)
- ✅ Inline styles only, no new UI libraries (Task 3)

**Placeholder scan:** None — all steps have complete code.

**Type consistency:**
- `ActiveEntry.pid?: number` defined Task 1, consumed by stop route Task 1 ✅
- `cliBin?: string` in `CockpitServerOptions` Task 1, threaded to `registerApiRoutes` Task 1, set in `cockpit.ts` Task 1 ✅
- `today_calls: number` added to GET response Task 2, added to `ServerStatus` type Task 2, rendered in panel Task 3 ✅
- `startServer`, `stopServer` defined Task 2, used in Task 3 ✅

**Known risk — `cockpitOrigin` in start route:** `fastify.server.address()` may return `null` if called before `listen()`. The `cockpitOrigin` variable is computed inside the route handler (at request time, not at registration time), so the server will be listening by then. Safe — but verify in tests by checking the spawned command args.
