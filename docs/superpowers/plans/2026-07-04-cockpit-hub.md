# Cockpit Hub Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decouple the Cockpit UI server from the MCP Bridge so `mcpinv cp` starts a standalone persistent hub on port 3000, while `mcpinv serve <id>` runs the bridge on port 3001 and registers itself with the hub.

**Architecture:** `CockpitServer` (new class) owns port 3000, reads `known_servers` from SQLite, and maintains an `ActiveRegistry` of currently-bridged servers in memory. `BridgeServer` (existing) registers/unregisters itself with the CockpitServer via HTTP on start/stop. `mcpinv import` writes discovered servers into `known_servers` so they persist across sessions.

**Tech Stack:** TypeScript, Fastify 4, better-sqlite3, commander, `open` (npm). All existing packages — no new dependencies.

## Global Constraints

- All source files: TypeScript ESM (`"type": "module"` in package.json)
- Test runner: vitest 1.x — run with `npm test` in `packages/bridge` or `packages/cli`
- No `SELECT *` in any SQL query; always name columns explicitly
- No new npm dependencies
- OSS language: English for all code, comments, and commit messages
- Default Cockpit port: **3000**; Default Bridge port: **3001** (changed from 3000)
- Registration endpoint: `POST /api/register` + `DELETE /api/register/:id` on the Cockpit server
- DB path: `~/.mcpinv/cockpit.db` (unchanged)

---

## File Structure

```
packages/bridge/src/
  db.ts                 MODIFY — add known_servers table + upsertKnownServer / listKnownServers
  registry.ts           CREATE — ActiveRegistry: in-memory map of running bridges
  cockpit-server.ts     CREATE — CockpitServer: Fastify + static + API, no McpClient
  api-routes.ts         MODIFY — /api/servers merges known+active; add POST/DELETE /api/register
  server.ts             MODIFY — register with cockpit on start; unregister on stop; upsert known_servers
  index.ts              MODIFY — export CockpitServer, ActiveRegistry
  types.ts              MODIFY — add CockpitServerOptions

packages/bridge/tests/
  db.test.ts            MODIFY — add known_servers tests
  registry.test.ts      CREATE — ActiveRegistry unit tests
  cockpit-server.test.ts CREATE — CockpitServer integration tests
  api-routes.test.ts    MODIFY — add register/unregister + merged-servers tests

packages/cli/src/commands/
  cockpit.ts            MODIFY — start CockpitServer + open browser (instead of just open)
  serve.ts              MODIFY — default port 3001; register with cockpit on start/stop
  import.ts             MODIFY — write known servers to SQLite after discovery
```

---

### Task 1: known_servers schema + db helpers

**Files:**
- Modify: `packages/bridge/src/db.ts`
- Modify: `packages/bridge/tests/db.test.ts`

**Interfaces:**
- Produces:
  - `upsertKnownServer(db: Database.Database, id: string): void`
  - `listKnownServers(db: Database.Database): KnownServer[]`
  - `interface KnownServer { id: string; registered_at: number; last_seen_at: number | null }`

- [ ] **Step 1: Write the failing tests**

Add to `packages/bridge/tests/db.test.ts` (after the existing 3 tests, before the closing `}`):

```typescript
  it('upsertKnownServer inserts a new server', () => {
    const db = openDb(join(tmpdir(), `mcpinv-test-${randomUUID()}.db`))
    upsertKnownServer(db, 'mira-local')
    const rows = listKnownServers(db)
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('mira-local')
    expect(rows[0].registered_at).toBeGreaterThan(0)
    expect(rows[0].last_seen_at).toBeNull()
    db.close()
  })

  it('upsertKnownServer is idempotent', () => {
    const db = openDb(join(tmpdir(), `mcpinv-test-${randomUUID()}.db`))
    upsertKnownServer(db, 'mira-local')
    upsertKnownServer(db, 'mira-local')
    expect(listKnownServers(db)).toHaveLength(1)
    db.close()
  })

  it('listKnownServers returns all registered servers', () => {
    const db = openDb(join(tmpdir(), `mcpinv-test-${randomUUID()}.db`))
    upsertKnownServer(db, 'mira-local')
    upsertKnownServer(db, 'mira-memory')
    const ids = listKnownServers(db).map(r => r.id)
    expect(ids).toContain('mira-local')
    expect(ids).toContain('mira-memory')
    db.close()
  })
```

Also update the import line at the top of `db.test.ts`:
```typescript
import { openDb, insertToolCall, upsertKnownServer, listKnownServers } from '../src/db.js'
```

- [ ] **Step 2: Run tests to verify they fail**

```powershell
cd packages/bridge && npm test -- tests/db.test.ts
```
Expected: 3 new tests FAIL with "upsertKnownServer is not a function"

- [ ] **Step 3: Add known_servers table and helpers to db.ts**

In `packages/bridge/src/db.ts`, add the interface and functions. The full updated file:

```typescript
import Database from 'better-sqlite3'
import { homedir } from 'os'
import { join, dirname } from 'path'
import { mkdirSync } from 'fs'

export interface ToolCallRow {
  id: number
  ts: number
  server_id: string
  tool_name: string
  args_hash: string
  duration_ms: number | null
  input_tokens: number | null
  output_tokens: number | null
  success: number
  error_msg: string | null
}

export interface KnownServer {
  id: string
  registered_at: number
  last_seen_at: number | null
}

const DEFAULT_DB_PATH = join(homedir(), '.mcpinv', 'cockpit.db')

export function openDb(path = DEFAULT_DB_PATH): Database.Database {
  mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS tool_calls (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      ts            INTEGER NOT NULL,
      server_id     TEXT    NOT NULL,
      tool_name     TEXT    NOT NULL,
      args_hash     TEXT    NOT NULL,
      duration_ms   INTEGER,
      input_tokens  INTEGER,
      output_tokens INTEGER,
      success       INTEGER NOT NULL,
      error_msg     TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_tc_ts     ON tool_calls(ts);
    CREATE INDEX IF NOT EXISTS idx_tc_server ON tool_calls(server_id);
    CREATE INDEX IF NOT EXISTS idx_tc_tool   ON tool_calls(tool_name);
    CREATE TABLE IF NOT EXISTS known_servers (
      id            TEXT    PRIMARY KEY,
      registered_at INTEGER NOT NULL,
      last_seen_at  INTEGER
    );
    CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL PRIMARY KEY);
    INSERT OR IGNORE INTO schema_version VALUES (1);
  `)
  return db
}

const _stmtCache = new WeakMap<Database.Database, Database.Statement>()

function getInsertStmt(db: Database.Database): Database.Statement {
  let stmt = _stmtCache.get(db)
  if (!stmt) {
    stmt = db.prepare(`
      INSERT INTO tool_calls
        (ts, server_id, tool_name, args_hash, duration_ms, input_tokens, output_tokens, success, error_msg)
      VALUES
        (@ts, @server_id, @tool_name, @args_hash, @duration_ms, @input_tokens, @output_tokens, @success, @error_msg)
    `)
    _stmtCache.set(db, stmt)
  }
  return stmt
}

export function insertToolCall(db: Database.Database, row: Omit<ToolCallRow, 'id'>): number {
  return Number(getInsertStmt(db).run(row).lastInsertRowid)
}

export function upsertKnownServer(db: Database.Database, id: string): void {
  db.prepare(`
    INSERT INTO known_servers (id, registered_at, last_seen_at)
    VALUES (?, ?, NULL)
    ON CONFLICT(id) DO NOTHING
  `).run(id, Date.now())
}

export function listKnownServers(db: Database.Database): KnownServer[] {
  return db.prepare(
    'SELECT id, registered_at, last_seen_at FROM known_servers ORDER BY registered_at'
  ).all() as KnownServer[]
}
```

- [ ] **Step 4: Run tests to verify they pass**

```powershell
cd packages/bridge && npm test -- tests/db.test.ts
```
Expected: 6 tests PASS

- [ ] **Step 5: Commit**

```powershell
git add packages/bridge/src/db.ts packages/bridge/tests/db.test.ts
git commit -m "feat: known_servers table + upsertKnownServer / listKnownServers"
```

---

### Task 2: ActiveRegistry

**Files:**
- Create: `packages/bridge/src/registry.ts`
- Create: `packages/bridge/tests/registry.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  interface ActiveEntry { server_id: string; port: number; started_at: number }
  class ActiveRegistry {
    register(server_id: string, port: number): void
    unregister(server_id: string): void
    getAll(): ActiveEntry[]
    get(server_id: string): ActiveEntry | undefined
  }
  ```

- [ ] **Step 1: Write the failing tests**

Create `packages/bridge/tests/registry.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { ActiveRegistry } from '../src/registry.js'

describe('ActiveRegistry', () => {
  let reg: ActiveRegistry

  beforeEach(() => { reg = new ActiveRegistry() })

  it('register adds a server entry', () => {
    reg.register('mira-local', 3001)
    const all = reg.getAll()
    expect(all).toHaveLength(1)
    expect(all[0].server_id).toBe('mira-local')
    expect(all[0].port).toBe(3001)
    expect(all[0].started_at).toBeGreaterThan(0)
  })

  it('register is idempotent — second call updates port', () => {
    reg.register('mira-local', 3001)
    reg.register('mira-local', 3002)
    expect(reg.getAll()).toHaveLength(1)
    expect(reg.get('mira-local')?.port).toBe(3002)
  })

  it('unregister removes a server entry', () => {
    reg.register('mira-local', 3001)
    reg.unregister('mira-local')
    expect(reg.getAll()).toHaveLength(0)
  })

  it('unregister on unknown id is a no-op', () => {
    expect(() => reg.unregister('unknown')).not.toThrow()
  })

  it('get returns undefined for unknown id', () => {
    expect(reg.get('unknown')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```powershell
cd packages/bridge && npm test -- tests/registry.test.ts
```
Expected: FAIL — "Cannot find module '../src/registry.js'"

- [ ] **Step 3: Implement ActiveRegistry**

Create `packages/bridge/src/registry.ts`:

```typescript
export interface ActiveEntry {
  server_id: string
  port: number
  started_at: number
}

export class ActiveRegistry {
  private readonly entries = new Map<string, ActiveEntry>()

  register(server_id: string, port: number): void {
    this.entries.set(server_id, { server_id, port, started_at: Date.now() })
  }

  unregister(server_id: string): void {
    this.entries.delete(server_id)
  }

  getAll(): ActiveEntry[] {
    return Array.from(this.entries.values())
  }

  get(server_id: string): ActiveEntry | undefined {
    return this.entries.get(server_id)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```powershell
cd packages/bridge && npm test -- tests/registry.test.ts
```
Expected: 5 tests PASS

- [ ] **Step 5: Commit**

```powershell
git add packages/bridge/src/registry.ts packages/bridge/tests/registry.test.ts
git commit -m "feat: ActiveRegistry — in-memory map of running bridges"
```

---

### Task 3: CockpitServer

**Files:**
- Create: `packages/bridge/src/cockpit-server.ts`
- Create: `packages/bridge/tests/cockpit-server.test.ts`
- Modify: `packages/bridge/src/index.ts`
- Modify: `packages/bridge/src/types.ts`

**Interfaces:**
- Consumes: `openDb`, `ActiveRegistry`, `registerApiRoutes`, `EventBus`
- Produces:
  ```typescript
  interface CockpitServerOptions {
    port: number
    host: string
    dbPath?: string
  }
  class CockpitServer {
    readonly registry: ActiveRegistry
    readonly eventBus: EventBus
    start(): Promise<void>
    stop(): Promise<void>
  }
  ```

- [ ] **Step 1: Write the failing tests**

Create `packages/bridge/tests/cockpit-server.test.ts`:

```typescript
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

  it('POST /api/register adds a server to active registry', async () => {
    server = new CockpitServer({ port: 0, host: '127.0.0.1', dbPath: dbPath() })
    await server.start()
    const port = (server as any).fastify.server.address().port
    const res = await fetch(`http://127.0.0.1:${port}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ server_id: 'mira-local', port: 3001 })
    })
    expect(res.status).toBe(200)
    expect(server.registry.get('mira-local')?.port).toBe(3001)
  })

  it('DELETE /api/register/:id removes server from active registry', async () => {
    server = new CockpitServer({ port: 0, host: '127.0.0.1', dbPath: dbPath() })
    await server.start()
    const port = (server as any).fastify.server.address().port
    server.registry.register('mira-local', 3001)
    const res = await fetch(`http://127.0.0.1:${port}/api/register/mira-local`, {
      method: 'DELETE'
    })
    expect(res.status).toBe(200)
    expect(server.registry.get('mira-local')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```powershell
cd packages/bridge && npm test -- tests/cockpit-server.test.ts
```
Expected: FAIL — "Cannot find module '../src/cockpit-server.js'"

- [ ] **Step 3: Add CockpitServerOptions to types.ts**

In `packages/bridge/src/types.ts`, add:

```typescript
export interface CockpitServerOptions {
  port: number
  host: string
  dbPath?: string
}
```

- [ ] **Step 4: Implement CockpitServer**

Create `packages/bridge/src/cockpit-server.ts`:

```typescript
import Fastify from 'fastify'
import type Database from 'better-sqlite3'
import { openDb } from './db.js'
import { EventBus } from './event-bus.js'
import { ActiveRegistry } from './registry.js'
import { registerApiRoutes } from './api-routes.js'
import type { CockpitServerOptions } from './types.js'

export class CockpitServer {
  private readonly fastify = Fastify({ logger: false })
  private started = false
  private readonly db: Database.Database
  readonly eventBus: EventBus
  readonly registry: ActiveRegistry

  constructor(private readonly options: CockpitServerOptions) {
    this.db = openDb(options.dbPath)
    this.eventBus = new EventBus()
    this.registry = new ActiveRegistry()
  }

  async start(): Promise<void> {
    if (this.started) return

    try {
      const { default: fastifyStatic } = await import('@fastify/static')
      const { join: pathJoin, dirname: pathDirname } = await import('path')
      const { fileURLToPath } = await import('url')
      const __dir = pathDirname(fileURLToPath(import.meta.url))
      await this.fastify.register(fastifyStatic, {
        root: pathJoin(__dir, 'public'),
        prefix: '/'
      })
    } catch {
      // public dir absent in development — UI runs on Vite :5173
    }

    await registerApiRoutes(this.fastify, this.db, this.eventBus, this.registry)
    await this.fastify.listen({ port: this.options.port, host: this.options.host })
    this.started = true
  }

  async stop(): Promise<void> {
    if (this.started) {
      await this.fastify.close()
      this.started = false
    }
  }
}
```

- [ ] **Step 5: Export from index.ts**

In `packages/bridge/src/index.ts`, add:

```typescript
export { CockpitServer } from './cockpit-server.js'
export { ActiveRegistry } from './registry.js'
export type { CockpitServerOptions } from './types.js'
```

- [ ] **Step 6: Run tests to verify they pass**

```powershell
cd packages/bridge && npm test -- tests/cockpit-server.test.ts
```
Expected: 3 tests PASS

- [ ] **Step 7: Commit**

```powershell
git add packages/bridge/src/cockpit-server.ts packages/bridge/src/registry.ts packages/bridge/src/index.ts packages/bridge/src/types.ts packages/bridge/tests/cockpit-server.test.ts
git commit -m "feat: CockpitServer — standalone hub server with ActiveRegistry"
```

---

### Task 4: Update api-routes — merge known+active, add register/unregister

**Files:**
- Modify: `packages/bridge/src/api-routes.ts`
- Modify: `packages/bridge/tests/api-routes.test.ts`

**Interfaces:**
- Consumes: `ActiveRegistry` (from Task 2), `listKnownServers` (from Task 1)
- `registerApiRoutes` signature changes: adds `registry: ActiveRegistry` parameter

Current signature:
```typescript
registerApiRoutes(fastify, db, eventBus, serverId: string)
```

New signature:
```typescript
registerApiRoutes(fastify, db, eventBus, registryOrServerId: ActiveRegistry | string)
```

When passed an `ActiveRegistry`: use merged known+active servers for `/api/servers`, enable `/api/register` endpoints.
When passed a `string` (serverId, legacy BridgeServer path): behave as before (single server entry).

- [ ] **Step 1: Write the failing tests**

Add to `packages/bridge/tests/api-routes.test.ts`. First, update imports to add `ActiveRegistry` and `upsertKnownServer`:

```typescript
import { ActiveRegistry } from '../src/registry.js'
import { upsertKnownServer } from '../src/db.js'
```

Then add a new `describe` block at the bottom (before the final `}`):

```typescript
describe('CockpitServer API (registry mode)', () => {
  let app: FastifyInstance
  let dbPath: string
  const paths: string[] = []

  async function buildCockpitApp(registry = new ActiveRegistry()) {
    const p = join(tmpdir(), `mcpinv-test-${randomUUID()}.db`)
    paths.push(p)
    const db = openDb(p)
    const bus = new EventBus()
    const a = Fastify()
    await registerApiRoutes(a, db, bus, registry)
    await a.ready()
    return { app: a, db, bus, registry }
  }

  afterAll(() => paths.forEach(p => { try { unlinkSync(p) } catch {} }))

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

  it('POST /api/register adds server to registry', async () => {
    const registry = new ActiveRegistry()
    const { app } = await buildCockpitApp(registry)
    const res = await app.inject({
      method: 'POST', url: '/api/register',
      headers: { 'content-type': 'application/json' },
      payload: { server_id: 'mira-local', port: 3001 }
    })
    expect(res.statusCode).toBe(200)
    expect(registry.get('mira-local')?.port).toBe(3001)
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
```

- [ ] **Step 2: Run tests to verify they fail**

```powershell
cd packages/bridge && npm test -- tests/api-routes.test.ts
```
Expected: 4 new tests FAIL

- [ ] **Step 3: Update registerApiRoutes**

Replace `packages/bridge/src/api-routes.ts` with:

```typescript
import type { FastifyInstance } from 'fastify'
import type Database from 'better-sqlite3'
import type { EventBus, CockpitEvent } from './event-bus.js'
import { listKnownServers } from './db.js'
import type { ActiveRegistry } from './registry.js'

const startTime = Date.now()

export async function registerApiRoutes(
  fastify: FastifyInstance,
  db: Database.Database,
  eventBus: EventBus,
  registryOrServerId: ActiveRegistry | string
): Promise<void> {
  const isRegistry = typeof registryOrServerId !== 'string'
  const legacyServerId = isRegistry ? null : registryOrServerId
  const registry = isRegistry ? registryOrServerId : null

  // GET /api/servers
  fastify.get('/api/servers', async () => {
    if (registry) {
      // Cockpit-hub mode: merge known (SQLite) + active (registry)
      const known = listKnownServers(db)
      const active = registry.getAll()
      const activeMap = new Map(active.map(e => [e.server_id, e]))
      return known.map(k => {
        const entry = activeMap.get(k.id)
        return entry
          ? { id: k.id, status: 'running', uptime_ms: Date.now() - entry.started_at, restart_count: 0, last_error: null }
          : { id: k.id, status: 'stopped', uptime_ms: null, restart_count: 0, last_error: null }
      })
    }
    // Legacy bridge mode: single server
    return [{ id: legacyServerId, status: 'running', uptime_ms: Date.now() - startTime, restart_count: 0, last_error: null }]
  })

  // Register/unregister endpoints (cockpit-hub mode only)
  if (registry) {
    fastify.post<{ Body: { server_id: string; port: number } }>('/api/register', async (req) => {
      registry.register(req.body.server_id, req.body.port)
      eventBus.emit_event({ type: 'server_up', data: { ts: Date.now(), server_id: req.body.server_id } })
      return { ok: true }
    })

    fastify.delete<{ Params: { id: string } }>('/api/register/:id', async (req) => {
      registry.unregister(req.params.id)
      eventBus.emit_event({ type: 'server_down', data: { ts: Date.now(), server_id: req.params.id } })
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
```

- [ ] **Step 4: Update BridgeServer to pass serverId (legacy mode)**

In `packages/bridge/src/server.ts`, the `registerApiRoutes` call currently passes `this.options.serverId`. That still works — the new overload accepts `string` for legacy mode. No change needed to server.ts in this task.

- [ ] **Step 5: Run all bridge tests to verify they pass**

```powershell
cd packages/bridge && npm test
```
Expected: all tests PASS (existing 9 api-routes tests + 4 new ones)

- [ ] **Step 6: Commit**

```powershell
git add packages/bridge/src/api-routes.ts packages/bridge/tests/api-routes.test.ts
git commit -m "feat: api-routes registry mode — merged known+active /api/servers, POST/DELETE /api/register"
```

---

### Task 5: BridgeServer registers with CockpitServer

**Files:**
- Modify: `packages/bridge/src/server.ts`
- Modify: `packages/bridge/tests/server.test.ts`
- Modify: `packages/bridge/src/types.ts`

**Interfaces:**
- Consumes: `upsertKnownServer` (Task 1)
- `BridgeServerOptions` gains optional `cockpitUrl?: string` (default `'http://localhost:3000'`)

- [ ] **Step 1: Add cockpitUrl to BridgeServerOptions**

In `packages/bridge/src/types.ts`, update `BridgeServerOptions`:

```typescript
export interface BridgeServerOptions {
  serverId: string
  port: number
  host: string
  logPath: string
  dbPath?: string
  cockpitUrl?: string  // default: 'http://localhost:3000'
}
```

- [ ] **Step 2: Write failing tests**

Add to `packages/bridge/tests/server.test.ts` (after existing tests):

```typescript
  it('registers with cockpit on start and unregisters on stop', async () => {
    const registered: unknown[] = []
    const unregistered: string[] = []

    // Minimal stub cockpit server
    const stub = Fastify()
    stub.post('/api/register', async (req) => { registered.push(req.body); return { ok: true } })
    stub.delete('/api/register/:id', async (req) => { unregistered.push(req.params.id); return { ok: true } })
    await stub.listen({ port: 0, host: '127.0.0.1' })
    const stubPort = (stub.server.address() as any).port

    const client = new MockMcpClient()
    const { server, dbPath: dp } = buildServer(client, {
      cockpitUrl: `http://127.0.0.1:${stubPort}`
    })
    paths.push(dp)

    await server.start()
    await server.stop()
    await stub.close()

    expect(registered).toHaveLength(1)
    expect((registered[0] as any).server_id).toBe('test-server')
    expect(unregistered).toContain('test-server')
  })
```

Note: `buildServer` in server.test.ts must accept an options override — check the existing helper signature and extend it to pass `cockpitUrl`.

- [ ] **Step 3: Update server.ts to register/unregister**

In `packages/bridge/src/server.ts`, add to the `start()` method after `this.eventBus.emit_event(...)`:

```typescript
// Non-fatal cockpit registration
const cockpitUrl = this.options.cockpitUrl ?? 'http://localhost:3000'
fetch(`${cockpitUrl}/api/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ server_id: this.options.serverId, port: this.options.port })
}).catch(() => {}) // cockpit may not be running
```

And in `stop()`, before `fastify.close()`:

```typescript
const cockpitUrl = this.options.cockpitUrl ?? 'http://localhost:3000'
await fetch(`${cockpitUrl}/api/register/${this.options.serverId}`, {
  method: 'DELETE'
}).catch(() => {})
```

Also add `upsertKnownServer` call in `start()` after the DB is ready:

```typescript
import { openDb, insertToolCall, upsertKnownServer } from './db.js'
// ...in start():
upsertKnownServer(this.db, this.options.serverId)
```

- [ ] **Step 4: Run all bridge tests**

```powershell
cd packages/bridge && npm test
```
Expected: all tests PASS

- [ ] **Step 5: Commit**

```powershell
git add packages/bridge/src/server.ts packages/bridge/src/types.ts packages/bridge/tests/server.test.ts
git commit -m "feat: BridgeServer registers/unregisters with CockpitServer on start/stop"
```

---

### Task 6: Update cockpit.ts command — start CockpitServer

**Files:**
- Modify: `packages/cli/src/commands/cockpit.ts`
- Modify: `packages/cli/tests/commands/cockpit.test.ts`

- [ ] **Step 1: Write failing tests**

Replace `packages/cli/tests/commands/cockpit.test.ts` with:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { cockpitCommand } from '../../src/commands/cockpit.js'

vi.mock('open', () => ({ default: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@mcpinv/bridge', () => ({
  CockpitServer: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined)
  }))
}))

describe('cockpitCommand', () => {
  it('is a command named "cockpit" with alias "cp"', () => {
    const cmd = cockpitCommand()
    expect(cmd.name()).toBe('cockpit')
    expect(cmd.aliases()).toContain('cp')
  })

  it('starts CockpitServer before opening browser', async () => {
    const { CockpitServer } = await import('@mcpinv/bridge')
    const open = (await import('open')).default

    await cockpitCommand().parseAsync([], { from: 'user' })

    expect(CockpitServer).toHaveBeenCalled()
    const instance = vi.mocked(CockpitServer).mock.results[0].value
    expect(instance.start).toHaveBeenCalled()
    expect(open).toHaveBeenCalledWith('http://localhost:3000')
  })

  it('respects --port option', async () => {
    const open = (await import('open')).default
    vi.mocked(open).mockClear()

    await cockpitCommand().parseAsync(['--port', '4000'], { from: 'user' })

    expect(open).toHaveBeenCalledWith('http://localhost:4000')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```powershell
cd packages/cli && npm test -- tests/commands/cockpit.test.ts
```
Expected: "starts CockpitServer" test FAILS (current impl doesn't start a server)

- [ ] **Step 3: Update cockpit.ts**

Replace `packages/cli/src/commands/cockpit.ts` with:

```typescript
import { Command } from 'commander'
import chalk from 'chalk'
import open from 'open'
import { CockpitServer } from '@mcpinv/bridge'

export function cockpitCommand(): Command {
  return new Command('cockpit')
    .alias('cp')
    .description('Start the mcpinv Cockpit hub and open it in the browser')
    .option('--port <number>', 'Cockpit port', (v) => parseInt(v, 10), 3000)
    .option('--host <host>', 'Bind host', 'localhost')
    .option('--db <path>', 'SQLite DB path (default: ~/.mcpinv/cockpit.db)')
    .action(async (opts: { port: number; host: string; db?: string }) => {
      const server = new CockpitServer({ port: opts.port, host: opts.host, dbPath: opts.db })
      try {
        await server.start()
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        // Port already in use = cockpit already running, just open browser
        if (!msg.includes('EADDRINUSE')) {
          console.error(chalk.red(`Failed to start Cockpit: ${msg}`))
          process.exit(1)
        }
      }

      const url = `http://${opts.host === '0.0.0.0' ? 'localhost' : opts.host}:${opts.port}`
      console.log(chalk.green(`✓ Cockpit running on ${url}`))
      await open(url).catch(() => {
        console.log(chalk.dim(`  Open manually: ${url}`))
      })

      const shutdown = async () => { await server.stop(); process.exit(0) }
      process.on('SIGINT', shutdown)
      process.on('SIGTERM', shutdown)
      setTimeout(() => {}, 2 ** 31 - 1)
    })
}
```

- [ ] **Step 4: Run tests to verify they pass**

```powershell
cd packages/cli && npm test -- tests/commands/cockpit.test.ts
```
Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```powershell
git add packages/cli/src/commands/cockpit.ts packages/cli/tests/commands/cockpit.test.ts
git commit -m "feat: mcpinv cockpit starts CockpitServer before opening browser"
```

---

### Task 7: Update serve.ts — default port 3001, register with cockpit

**Files:**
- Modify: `packages/cli/src/commands/serve.ts`
- Modify: `packages/cli/tests/commands/serve.test.ts`

- [ ] **Step 1: Write failing test**

Add to `packages/cli/tests/commands/serve.test.ts`:

```typescript
  it('defaults to port 3001', () => {
    const cmd = serveCommand()
    const portOpt = cmd.options.find((o: { long: string }) => o.long === '--port')
    expect(portOpt?.defaultValue).toBe(3001)
  })
```

- [ ] **Step 2: Run to verify it fails**

```powershell
cd packages/cli && npm test -- tests/commands/serve.test.ts
```
Expected: new test FAILS (current default is 3000)

- [ ] **Step 3: Update serve.ts**

In `packages/cli/src/commands/serve.ts`:

Change port default from `3000` to `3001`:
```typescript
.option('--port <number>', 'HTTP port', (v) => parseInt(v, 10), 3001)
```

Add `--cockpit-url` option:
```typescript
.option('--cockpit-url <url>', 'Cockpit hub URL to register with', 'http://localhost:3000')
```

Update the opts type in action:
```typescript
.action(async (serverId: string, opts: { port: number; host: string; watch: boolean; telemetry: boolean; cockpitUrl: string }) => {
```

Pass `cockpitUrl` to `BridgeServer`:
```typescript
const server = new BridgeServer(client, {
  serverId,
  port: opts.port,
  host: opts.host,
  logPath,
  cockpitUrl: opts.cockpitUrl
})
```

- [ ] **Step 4: Run all CLI tests**

```powershell
cd packages/cli && npm test
```
Expected: all tests PASS

- [ ] **Step 5: Commit**

```powershell
git add packages/cli/src/commands/serve.ts packages/cli/tests/commands/serve.test.ts
git commit -m "feat: mcpinv serve defaults to port 3001; registers with cockpit hub"
```

---

### Task 8: Update import.ts — write known servers to SQLite

**Files:**
- Modify: `packages/cli/src/commands/import.ts`
- Modify: `packages/cli/tests/commands/import.test.ts`

- [ ] **Step 1: Write failing test**

Add to `packages/cli/tests/commands/import.test.ts`:

```typescript
vi.mock('@mcpinv/bridge', () => ({
  openDb: vi.fn().mockReturnValue({ close: vi.fn() }),
  upsertKnownServer: vi.fn()
}))

// inside describe('importCommand'):
  it('writes discovered servers to SQLite known_servers', async () => {
    const { listInstalled } = await import('../../src/services/config-manager.js')
    const { upsertKnownServer, openDb } = await import('@mcpinv/bridge')
    vi.mocked(listInstalled).mockResolvedValue(['mira-memory', 'filesystem'])

    await importCommand().parseAsync([], { from: 'user' })

    expect(openDb).toHaveBeenCalled()
    expect(upsertKnownServer).toHaveBeenCalledWith(expect.anything(), 'mira-memory')
    expect(upsertKnownServer).toHaveBeenCalledWith(expect.anything(), 'filesystem')
  })
```

- [ ] **Step 2: Run to verify it fails**

```powershell
cd packages/cli && npm test -- tests/commands/import.test.ts
```
Expected: new test FAILS

- [ ] **Step 3: Update import.ts**

Replace `packages/cli/src/commands/import.ts` with:

```typescript
import { Command } from 'commander'
import chalk from 'chalk'
import { listInstalled } from '../services/config-manager.js'
import { openDb, upsertKnownServer } from '@mcpinv/bridge'

export function importCommand(): Command {
  return new Command('import')
    .description('Discover MCP servers already configured in Claude Desktop / Cursor and register them in the Cockpit')
    .action(async () => {
      const ids = await listInstalled()

      if (ids.length === 0) {
        console.log(chalk.yellow('No MCP servers found in your config. Install one with: mcpinv install <id>'))
        return
      }

      const db = openDb()
      for (const id of ids) {
        upsertKnownServer(db, id)
      }
      db.close()

      console.log(chalk.bold(`\n${ids.length} server(s) found and registered in Cockpit:\n`))
      for (const id of ids) {
        console.log(`  ${chalk.cyan(id)}`)
        console.log(`  ${chalk.green(`mcpinv serve ${id}`)}\n`)
      }
    })
}
```

- [ ] **Step 4: Run all CLI tests**

```powershell
cd packages/cli && npm test
```
Expected: all tests PASS

- [ ] **Step 5: Build everything**

```powershell
cd C:\Users\Anwender\IdeaProjects\mcpinv
npm run build:ui
cd packages/cli && npm run build
```

- [ ] **Step 6: Commit**

```powershell
git add packages/cli/src/commands/import.ts packages/cli/tests/commands/import.test.ts
git commit -m "feat: mcpinv import writes discovered servers to cockpit.db known_servers"
```

---

## Self-Review

**Spec coverage:**
- ✅ `mcpinv cp` starts CockpitServer independently (Task 6)
- ✅ Servers persist across sessions via `known_servers` SQLite table (Task 1)
- ✅ `mcpinv import` writes to known_servers (Task 8)
- ✅ `mcpinv serve` registers live status with cockpit (Task 5)
- ✅ `/api/servers` returns known servers as stopped when bridge not running (Task 4)
- ✅ SSE emits server_up/server_down on register/unregister (Task 4)
- ✅ Default port separation: cockpit=3000, bridge=3001 (Task 7)
- ✅ EADDRINUSE handled gracefully in cockpit command (Task 6)
- ✅ Registration with cockpit is non-fatal for bridge (Task 5)

**Placeholder scan:** None found — all steps contain complete code.

**Type consistency:**
- `ActiveRegistry` defined Task 2, consumed in Tasks 3, 4, 5, 6 ✅
- `KnownServer` defined Task 1, used in api-routes Task 4 ✅
- `CockpitServerOptions` defined Task 3, used in cockpit.ts Task 6 ✅
- `registerApiRoutes` new signature (Task 4) consumed by `CockpitServer` (Task 3) ✅
- `cockpitUrl` in `BridgeServerOptions` (Task 5) passed from `serve.ts` (Task 7) ✅
