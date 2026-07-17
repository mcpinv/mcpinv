# mcpinv Cockpit UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local web UI at `http://localhost:3001` that gives developers real-time visibility into running MCP servers, tool calls, and token usage — zero extra install steps beyond `mcpinv serve`.

**Architecture:** The existing Fastify Bridge server is extended to serve a compiled React SPA as static files and expose 5 new REST endpoints + 1 SSE stream. A new `packages/ui` workspace holds the React app; `vite build` outputs into `packages/bridge/dist/public/`. A Panel Registry pattern makes adding future panels a one-file operation.

**Tech Stack:** React 18, Vite 5, React Router v6, Recharts, Tailwind CSS, lucide-react, better-sqlite3, @fastify/static, EventEmitter (Node built-in)

---

## File Map

### New files — `packages/bridge/src/`
- `db.ts` — SQLite open/migrate/insert helpers (better-sqlite3)
- `event-bus.ts` — typed EventEmitter for live cockpit events
- `api-routes.ts` — 5 REST endpoints + SSE endpoint registered as Fastify plugin

### Modified files — `packages/bridge/`
- `package.json` — add `better-sqlite3`, `@fastify/static`
- `src/server.ts` — inject db + eventBus, call `registerApiRoutes`, serve static files, emit `server_up`/`server_down` events
- `src/types.ts` — extend `BridgeServerOptions` with optional `dbPath`

### Modified files — `packages/cli/`
- `src/commands/serve.ts` — open browser after server starts (add `open` package)
- `package.json` — add `open`

### New package — `packages/ui/`
- `package.json`
- `vite.config.ts`
- `tsconfig.json`
- `index.html`
- `src/main.tsx`
- `src/registry.ts` — Panel interface + panel list
- `src/shell/App.tsx` — layout, nav, router
- `src/api/client.ts` — typed fetch + SSE wrappers
- `src/panels/servers/index.tsx` — Servers panel component + panel export
- `src/panels/calls/index.tsx` — Call Log panel component + panel export
- `src/panels/tokens/index.tsx` — Token Usage panel component + panel export

### Modified files — root
- `package.json` — add `packages/ui` to workspaces

---

## Task 1: SQLite data layer

**Files:**
- Create: `packages/bridge/src/db.ts`
- Create: `packages/bridge/tests/db.test.ts`
- Modify: `packages/bridge/package.json`

- [ ] **Step 1: Install better-sqlite3**

```bash
cd packages/bridge
npm install better-sqlite3
npm install --save-dev @types/better-sqlite3
```

- [ ] **Step 2: Write the failing test**

```typescript
// packages/bridge/tests/db.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import { openDb, insertToolCall } from '../src/db.js'
import { unlinkSync, existsSync } from 'fs'

const TEST_DB = '/tmp/mcpinv-test.db'

afterEach(() => { if (existsSync(TEST_DB)) unlinkSync(TEST_DB) })

describe('openDb', () => {
  it('creates schema on first open', () => {
    const db = openDb(TEST_DB)
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
    const names = (tables as any[]).map(t => t.name)
    expect(names).toContain('tool_calls')
    expect(names).toContain('schema_version')
    db.close()
  })

  it('is idempotent — second open does not throw', () => {
    const db1 = openDb(TEST_DB); db1.close()
    expect(() => { const db2 = openDb(TEST_DB); db2.close() }).not.toThrow()
  })
})

describe('insertToolCall', () => {
  it('inserts a row and returns its id', () => {
    const db = openDb(TEST_DB)
    const id = insertToolCall(db, {
      ts: Date.now(),
      server_id: 'test-server',
      tool_name: 'read_file',
      args_hash: 'abc123',
      duration_ms: 42,
      input_tokens: null,
      output_tokens: null,
      success: 1,
      error_msg: null
    })
    expect(id).toBeGreaterThan(0)
    const row = db.prepare('SELECT * FROM tool_calls WHERE id = ?').get(id) as any
    expect(row.tool_name).toBe('read_file')
    expect(row.success).toBe(1)
    db.close()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd packages/bridge && npm test -- tests/db.test.ts
```
Expected: FAIL — `Cannot find module '../src/db.js'`

- [ ] **Step 4: Implement db.ts**

```typescript
// packages/bridge/src/db.ts
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
  duration_ms: number
  input_tokens: number | null
  output_tokens: number | null
  success: number   // 0 | 1 (SQLite has no boolean)
  error_msg: string | null
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
    CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);
    INSERT OR IGNORE INTO schema_version VALUES (1);
  `)
  return db
}

export function insertToolCall(
  db: Database.Database,
  row: Omit<ToolCallRow, 'id'>
): number {
  const stmt = db.prepare(`
    INSERT INTO tool_calls
      (ts, server_id, tool_name, args_hash, duration_ms, input_tokens, output_tokens, success, error_msg)
    VALUES
      (@ts, @server_id, @tool_name, @args_hash, @duration_ms, @input_tokens, @output_tokens, @success, @error_msg)
  `)
  return Number((stmt.run(row)).lastInsertRowid)
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd packages/bridge && npm test -- tests/db.test.ts
```
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add packages/bridge/src/db.ts packages/bridge/tests/db.test.ts packages/bridge/package.json packages/bridge/package-lock.json
git commit -m "feat: SQLite data layer for cockpit (better-sqlite3)"
```

---

## Task 2: Event bus + BridgeServer wiring

**Files:**
- Create: `packages/bridge/src/event-bus.ts`
- Create: `packages/bridge/tests/event-bus.test.ts`
- Modify: `packages/bridge/src/types.ts` (add `dbPath?`)
- Modify: `packages/bridge/src/server.ts` (inject db + eventBus, emit on tool calls)

- [ ] **Step 1: Write the failing test**

```typescript
// packages/bridge/tests/event-bus.test.ts
import { describe, it, expect, vi } from 'vitest'
import { EventBus } from '../src/event-bus.js'

describe('EventBus', () => {
  it('delivers emitted events to listeners', () => {
    const bus = new EventBus()
    const received: any[] = []
    bus.on_event(e => received.push(e))
    bus.emit_event({ type: 'tool_call', data: {
      id: 1, ts: Date.now(), server_id: 's', tool_name: 't',
      duration_ms: 10, input_tokens: null, output_tokens: null,
      success: true, error_msg: null
    }})
    expect(received).toHaveLength(1)
    expect(received[0].type).toBe('tool_call')
  })

  it('off_event stops delivery', () => {
    const bus = new EventBus()
    const received: any[] = []
    const listener = (e: any) => received.push(e)
    bus.on_event(listener)
    bus.off_event(listener)
    bus.emit_event({ type: 'server_up', data: { ts: Date.now(), server_id: 's' } })
    expect(received).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/bridge && npm test -- tests/event-bus.test.ts
```
Expected: FAIL — `Cannot find module '../src/event-bus.js'`

- [ ] **Step 3: Implement event-bus.ts**

```typescript
// packages/bridge/src/event-bus.ts
import { EventEmitter } from 'events'

export interface ToolCallEvent {
  id: number
  ts: number
  server_id: string
  tool_name: string
  duration_ms: number
  input_tokens: number | null
  output_tokens: number | null
  success: boolean
  error_msg: string | null
}

export type CockpitEvent =
  | { type: 'tool_call';    data: ToolCallEvent }
  | { type: 'server_up';   data: { ts: number; server_id: string } }
  | { type: 'server_down'; data: { ts: number; server_id: string } }
  | { type: 'server_error';data: { ts: number; server_id: string; message: string } }

export class EventBus extends EventEmitter {
  emit_event(event: CockpitEvent): void {
    this.emit('cockpit', event)
  }
  on_event(listener: (event: CockpitEvent) => void): void {
    this.on('cockpit', listener)
  }
  off_event(listener: (event: CockpitEvent) => void): void {
    this.off('cockpit', listener)
  }
}
```

- [ ] **Step 4: Extend BridgeServerOptions in types.ts**

Add `dbPath?: string` to the existing `BridgeServerOptions` interface:

```typescript
// packages/bridge/src/types.ts — add to BridgeServerOptions:
export interface BridgeServerOptions {
  serverId: string
  port: number
  host: string
  logPath: string
  dbPath?: string   // <-- add this line
}
```

- [ ] **Step 5: Wire db + eventBus into BridgeServer**

Replace `packages/bridge/src/server.ts` with:

```typescript
// packages/bridge/src/server.ts
import Fastify from 'fastify'
import { appendFileSync, mkdirSync } from 'fs'
import { createHash } from 'crypto'
import { dirname } from 'path'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import type Database from 'better-sqlite3'
import type { McpClient } from './mcp-client.js'
import { generateOpenApiSpec } from './openapi.js'
import type { BridgeServerOptions } from './types.js'
import { openDb, insertToolCall } from './db.js'
import { EventBus } from './event-bus.js'

export class BridgeServer {
  private fastify = Fastify({ logger: false })
  private tools: Tool[] = []
  private spec: object = {}
  private started = false
  private db: Database.Database
  readonly eventBus: EventBus

  constructor(
    private readonly client: McpClient,
    private readonly options: BridgeServerOptions,
    db?: Database.Database,
    eventBus?: EventBus
  ) {
    this.db = db ?? openDb(options.dbPath)
    this.eventBus = eventBus ?? new EventBus()
  }

  async start(): Promise<void> {
    if (this.started) return
    this.tools = await this.client.listTools()
    this.spec = generateOpenApiSpec(this.options.serverId, this.tools)
    this.registerRoutes()
    await this.fastify.listen({ port: this.options.port, host: this.options.host })
    this.started = true
    this.eventBus.emit_event({ type: 'server_up', data: { ts: Date.now(), server_id: this.options.serverId } })
    this.log(`bridge started on ${this.options.host}:${this.options.port}`)
  }

  updateTools(tools: Tool[]): void {
    const before = this.tools.length
    this.tools = tools
    this.spec = generateOpenApiSpec(this.options.serverId, tools)
    this.log(`[hot-swap] ${before} tools → ${tools.length} tools`)
  }

  private registerRoutes(): void {
    this.fastify.get('/openapi.json', async () => this.spec)

    this.fastify.get('/tools', async () => ({
      tools: this.tools.map(t => ({ name: t.name, description: t.description ?? '' }))
    }))

    this.fastify.post<{ Params: { name: string }; Body: Record<string, unknown> }>(
      '/tools/:name',
      async (request, reply) => {
        const tool = this.tools.find(t => t.name === request.params.name)
        if (!tool) {
          return reply.code(404).send({ error: 'tool_not_found', tool: request.params.name })
        }
        const start = Date.now()
        try {
          const result = await this.client.callTool(request.params.name, request.body ?? {})
          const duration_ms = Date.now() - start
          const id = insertToolCall(this.db, {
            ts: Date.now(),
            server_id: this.options.serverId,
            tool_name: request.params.name,
            args_hash: createHash('sha256').update(JSON.stringify(request.body ?? {})).digest('hex').slice(0, 16),
            duration_ms,
            input_tokens: null,
            output_tokens: null,
            success: 1,
            error_msg: null
          })
          this.eventBus.emit_event({ type: 'tool_call', data: {
            id, ts: Date.now(), server_id: this.options.serverId,
            tool_name: request.params.name, duration_ms,
            input_tokens: null, output_tokens: null,
            success: true, error_msg: null
          }})
          this.log(`[tool] ${request.params.name} ok`)
          return result
        } catch (err) {
          const duration_ms = Date.now() - start
          const message = err instanceof Error ? err.message : String(err)
          insertToolCall(this.db, {
            ts: Date.now(),
            server_id: this.options.serverId,
            tool_name: request.params.name,
            args_hash: createHash('sha256').update(JSON.stringify(request.body ?? {})).digest('hex').slice(0, 16),
            duration_ms,
            input_tokens: null,
            output_tokens: null,
            success: 0,
            error_msg: message.slice(0, 500)
          })
          this.log(`[tool] ${request.params.name} error: ${message}`)
          return reply.code(422).send({ error: 'tool_failed', message, tool: request.params.name })
        }
      }
    )
  }

  private log(message: string): void {
    const entry = JSON.stringify({ ts: new Date().toISOString(), msg: message })
    try {
      mkdirSync(dirname(this.options.logPath), { recursive: true })
      appendFileSync(this.options.logPath, entry + '\n')
    } catch (err) {
      console.error(`[BridgeServer] Failed to write log: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async stop(): Promise<void> {
    if (this.started) {
      this.eventBus.emit_event({ type: 'server_down', data: { ts: Date.now(), server_id: this.options.serverId } })
      await this.fastify.close()
      this.started = false
    }
  }
}
```

- [ ] **Step 6: Run all bridge tests**

```bash
cd packages/bridge && npm test
```
Expected: all existing tests + 2 new event-bus tests PASS

- [ ] **Step 7: Commit**

```bash
git add packages/bridge/src/event-bus.ts packages/bridge/src/server.ts \
        packages/bridge/src/types.ts packages/bridge/src/db.ts \
        packages/bridge/tests/event-bus.test.ts
git commit -m "feat: event bus + db wiring in BridgeServer"
```

---

## Task 3: REST API endpoints + SSE

**Files:**
- Create: `packages/bridge/src/api-routes.ts`
- Create: `packages/bridge/tests/api-routes.test.ts`
- Modify: `packages/bridge/package.json` (add `@fastify/static`)
- Modify: `packages/bridge/src/server.ts` (call `registerApiRoutes` + serve static)

- [ ] **Step 1: Install @fastify/static**

```bash
cd packages/bridge && npm install @fastify/static
```

- [ ] **Step 2: Write the failing test**

```typescript
// packages/bridge/tests/api-routes.test.ts
import { describe, it, expect, afterAll } from 'vitest'
import Fastify from 'fastify'
import { unlinkSync, existsSync } from 'fs'
import { openDb, insertToolCall } from '../src/db.js'
import { EventBus } from '../src/event-bus.js'
import { registerApiRoutes } from '../src/api-routes.js'

const TEST_DB = '/tmp/mcpinv-api-test.db'
afterAll(() => { if (existsSync(TEST_DB)) unlinkSync(TEST_DB) })

async function buildApp() {
  const db = openDb(TEST_DB)
  const bus = new EventBus()
  const app = Fastify()
  await registerApiRoutes(app, db, bus, 'test-server')
  await app.ready()
  return { app, db, bus }
}

describe('GET /api/servers', () => {
  it('returns server status array', async () => {
    const { app } = await buildApp()
    const r = await app.inject({ method: 'GET', url: '/api/servers' })
    expect(r.statusCode).toBe(200)
    const body = JSON.parse(r.body)
    expect(Array.isArray(body)).toBe(true)
    expect(body[0]).toHaveProperty('id', 'test-server')
    expect(body[0]).toHaveProperty('status', 'running')
  })
})

describe('GET /api/calls', () => {
  it('returns empty array when no calls', async () => {
    const { app } = await buildApp()
    const r = await app.inject({ method: 'GET', url: '/api/calls' })
    expect(r.statusCode).toBe(200)
    expect(JSON.parse(r.body)).toEqual([])
  })

  it('returns inserted calls', async () => {
    const { app, db } = await buildApp()
    insertToolCall(db, { ts: Date.now(), server_id: 'test-server', tool_name: 'do_thing',
      args_hash: 'x', duration_ms: 5, input_tokens: null, output_tokens: null,
      success: 1, error_msg: null })
    const r = await app.inject({ method: 'GET', url: '/api/calls?limit=10' })
    const body = JSON.parse(r.body)
    expect(body.length).toBeGreaterThan(0)
    expect(body[0].tool_name).toBe('do_thing')
  })
})

describe('GET /api/tokens/summary', () => {
  it('returns summary with total_calls', async () => {
    const { app } = await buildApp()
    const r = await app.inject({ method: 'GET', url: '/api/tokens/summary' })
    expect(r.statusCode).toBe(200)
    const body = JSON.parse(r.body)
    expect(body).toHaveProperty('total_calls')
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
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd packages/bridge && npm test -- tests/api-routes.test.ts
```
Expected: FAIL — `Cannot find module '../src/api-routes.js'`

- [ ] **Step 4: Implement api-routes.ts**

```typescript
// packages/bridge/src/api-routes.ts
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
    const limit = parseInt(q.limit ?? '100')
    const parts: string[] = ['WHERE 1=1']
    const params: unknown[] = []
    if (q.server)            { parts.push('AND server_id = ?'); params.push(q.server) }
    if (q.status === 'ok')   { parts.push('AND success = 1') }
    if (q.status === 'error'){ parts.push('AND success = 0') }
    params.push(limit)
    return db.prepare(
      `SELECT * FROM tool_calls ${parts.join(' ')} ORDER BY ts DESC LIMIT ?`
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
    const days = parseInt(q.days ?? '14')
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

  // SSE — one persistent connection per client
  fastify.get('/api/events', (req, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection:      'keep-alive'
    })
    reply.raw.write(':\n\n')  // initial keepalive comment

    const listener = (event: CockpitEvent) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
    }
    eventBus.on_event(listener)
    req.raw.on('close', () => eventBus.off_event(listener))

    return reply
  })
}
```

- [ ] **Step 5: Register routes in BridgeServer**

In `packages/bridge/src/server.ts`, add to imports:

```typescript
import fastifyStatic from '@fastify/static'
import { join, dirname as pathDirname } from 'path'
import { fileURLToPath } from 'url'
import { registerApiRoutes } from './api-routes.js'
```

Then inside `start()`, before `this.registerRoutes()`:

```typescript
const __dirname = pathDirname(fileURLToPath(import.meta.url))
const publicDir = join(__dirname, 'public')

// Serve compiled UI (gracefully skipped if not built yet)
try {
  await this.fastify.register(fastifyStatic, { root: publicDir, prefix: '/' })
} catch {
  // public dir absent during development — UI served by Vite on :5173
}

await registerApiRoutes(this.fastify, this.db, this.eventBus, this.options.serverId)
```

- [ ] **Step 6: Run all bridge tests**

```bash
cd packages/bridge && npm test
```
Expected: all tests PASS

- [ ] **Step 7: Commit**

```bash
git add packages/bridge/src/api-routes.ts packages/bridge/src/server.ts \
        packages/bridge/tests/api-routes.test.ts packages/bridge/package.json \
        package-lock.json
git commit -m "feat: REST API endpoints + SSE stream for cockpit"
```

---

## Task 4: CLI browser auto-open

**Files:**
- Modify: `packages/cli/package.json` (add `open`)
- Modify: `packages/cli/src/commands/serve.ts` (open browser after start)

- [ ] **Step 1: Install open**

```bash
cd packages/cli && npm install open
```

- [ ] **Step 2: Add browser open to serve.ts**

Add import at the top of `packages/cli/src/commands/serve.ts`:

```typescript
import open from 'open'
```

After the existing startup log lines (after `console.log(... '/tools' ...)`), add:

```typescript
const cockpitUrl = `http://${opts.host === '0.0.0.0' ? 'localhost' : opts.host}:${opts.port}`
console.log(chalk.dim(`  Cockpit UI:    ${cockpitUrl}`))
open(cockpitUrl).catch(() => {
  // non-fatal — headless environments have no browser
})
```

- [ ] **Step 3: Verify CLI tests still pass**

```bash
cd packages/cli && npm test
```
Expected: all tests PASS

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/commands/serve.ts packages/cli/package.json package-lock.json
git commit -m "feat: auto-open cockpit UI in browser on mcpinv serve"
```

---

## Task 5: packages/ui scaffold

**Files:**
- Create: `packages/ui/package.json`
- Create: `packages/ui/vite.config.ts`
- Create: `packages/ui/tsconfig.json`
- Create: `packages/ui/index.html`
- Create: `packages/ui/src/main.tsx`
- Create: `packages/ui/src/registry.ts`
- Create: `packages/ui/src/shell/App.tsx`
- Create: `packages/ui/src/api/client.ts`
- Modify: root `package.json` (workspaces already covers `packages/*` — no change needed)

- [ ] **Step 1: Create package.json**

```json
// packages/ui/package.json
{
  "name": "@mcpinv/ui",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run"
  },
  "dependencies": {
    "lucide-react": "^0.400.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "react-router-dom": "^6.24.0",
    "recharts": "^2.12.0"
  },
  "devDependencies": {
    "@testing-library/react": "^16.0.0",
    "@testing-library/user-event": "^14.5.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "jsdom": "^24.0.0",
    "typescript": "^5.5.0",
    "vite": "^5.3.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: Install dependencies**

```bash
cd packages/ui && npm install
```

- [ ] **Step 3: Create vite.config.ts**

```typescript
// packages/ui/vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../bridge/dist/public',
    emptyOutDir: true
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001'
    }
  },
  test: {
    environment: 'jsdom'
  }
})
```

- [ ] **Step 4: Create tsconfig.json**

```json
// packages/ui/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

- [ ] **Step 5: Create index.html**

```html
<!-- packages/ui/index.html -->
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>mcpinv Cockpit</title>
    <style>
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
      body { background: #030712; color: #f9fafb; font-family: ui-monospace, monospace; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Create src/api/client.ts**

```typescript
// packages/ui/src/api/client.ts
const BASE = ''

export interface ServerStatus {
  id: string
  status: 'running' | 'stopped' | 'error'
  uptime_ms: number
  restart_count: number
  last_error: string | null
}

export interface ToolCall {
  id: number
  ts: number
  server_id: string
  tool_name: string
  duration_ms: number
  input_tokens: number | null
  output_tokens: number | null
  success: number
  error_msg: string | null
}

export interface TokenSummary {
  total_calls: number
  total_input_tokens: number | null
  total_output_tokens: number | null
  top_tool: { name: string; calls: number } | null
}

export interface DailyBucket {
  date: string
  calls: number
  input_tokens: number | null
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`)
  if (!r.ok) throw new Error(`${path}: ${r.status}`)
  return r.json() as Promise<T>
}

export const getServers    = () => get<ServerStatus[]>('/api/servers')
export const getTokenSummary = () => get<TokenSummary>('/api/tokens/summary')
export const getTokensDaily  = (days = 14) => get<DailyBucket[]>(`/api/tokens/daily?days=${days}`)

export function getCalls(params?: { limit?: number; server?: string; status?: string }) {
  const q = new URLSearchParams()
  if (params?.limit)  q.set('limit',  String(params.limit))
  if (params?.server) q.set('server', params.server)
  if (params?.status) q.set('status', params.status)
  return get<ToolCall[]>(`/api/calls?${q}`)
}

export function subscribeEvents(onEvent: (e: unknown) => void): () => void {
  const es = new EventSource(`${BASE}/api/events`)
  es.onmessage = e => onEvent(JSON.parse(e.data as string))
  return () => es.close()
}
```

- [ ] **Step 7: Create registry.ts**

```typescript
// packages/ui/src/registry.ts
import type { ComponentType } from 'react'

export interface Panel {
  id: string
  label: string
  route: string
  component: ComponentType
  badge?: () => number | null
  tier?: 'free' | 'pro'
  order?: number
}

// Add one import per panel here — that's the only change needed to register a new panel
import { panel as servers } from './panels/servers/index.js'
import { panel as calls }   from './panels/calls/index.js'
import { panel as tokens }  from './panels/tokens/index.js'

export const panels: Panel[] = [servers, calls, tokens]
  .sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
```

- [ ] **Step 8: Create shell/App.tsx**

```tsx
// packages/ui/src/shell/App.tsx
import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom'
import { panels } from '../registry.js'

export function App() {
  return (
    <BrowserRouter>
      <div style={{ display: 'flex', height: '100vh' }}>
        <nav style={{
          width: 176, background: '#111827', borderRight: '1px solid #1f2937',
          display: 'flex', flexDirection: 'column', padding: '16px 8px', gap: 4
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', padding: '0 8px', marginBottom: 12 }}>
            mcpinv cockpit
          </div>
          {panels.map(p => (
            <NavLink
              key={p.id}
              to={p.route}
              style={({ isActive }) => ({
                padding: '6px 10px', borderRadius: 6, fontSize: 13, textDecoration: 'none',
                color: isActive ? '#f9fafb' : '#9ca3af',
                background: isActive ? '#1f2937' : 'transparent'
              })}
            >
              {p.label}
            </NavLink>
          ))}
        </nav>
        <main style={{ flex: 1, overflow: 'auto', padding: 24 }}>
          <Routes>
            <Route path="/" element={<Navigate to={panels[0].route} replace />} />
            {panels.map(p => (
              <Route key={p.id} path={p.route} element={<p.component />} />
            ))}
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
```

- [ ] **Step 9: Create src/main.tsx**

```tsx
// packages/ui/src/main.tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './shell/App.js'

createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>
)
```

- [ ] **Step 10: Write a smoke test**

```typescript
// packages/ui/src/tests/registry.test.ts
import { describe, it, expect } from 'vitest'
import { panels } from '../registry.js'

describe('panel registry', () => {
  it('has at least 3 panels', () => {
    expect(panels.length).toBeGreaterThanOrEqual(3)
  })
  it('each panel has required fields', () => {
    for (const p of panels) {
      expect(p.id).toBeTruthy()
      expect(p.label).toBeTruthy()
      expect(p.route).toMatch(/^\//)
      expect(typeof p.component).toBe('function')
    }
  })
  it('panel ids are unique', () => {
    const ids = panels.map(p => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
```

- [ ] **Step 11: Run UI tests**

```bash
cd packages/ui && npm test
```
Expected: PASS (3 tests)

- [ ] **Step 12: Commit**

```bash
git add packages/ui/
git commit -m "feat: packages/ui scaffold — shell, registry, API client"
```

---

## Task 6: Servers panel

**Files:**
- Create: `packages/ui/src/panels/servers/index.tsx`
- Create: `packages/ui/src/panels/servers/servers.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/ui/src/panels/servers/servers.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { panel } from './index.js'
import * as client from '../../api/client.js'

vi.mock('../../api/client.js')

const mockServer = {
  id: 'my-server', status: 'running' as const,
  uptime_ms: 65000, restart_count: 0, last_error: null
}

beforeEach(() => {
  vi.mocked(client.getServers).mockResolvedValue([mockServer])
  vi.mocked(client.subscribeEvents).mockReturnValue(() => {})
})

describe('ServersPanel', () => {
  it('renders the panel', () => {
    expect(panel.id).toBe('servers')
    expect(panel.label).toBe('Servers')
  })

  it('displays server id and status', async () => {
    render(<MemoryRouter><panel.component /></MemoryRouter>)
    await waitFor(() => screen.getByText('my-server'))
    expect(screen.getByText('running')).toBeTruthy()
  })

  it('shows uptime in human-readable format', async () => {
    render(<MemoryRouter><panel.component /></MemoryRouter>)
    await waitFor(() => screen.getByText('1m'))
  })

  it('shows error state when fetch fails', async () => {
    vi.mocked(client.getServers).mockRejectedValue(new Error('network down'))
    render(<MemoryRouter><panel.component /></MemoryRouter>)
    await waitFor(() => screen.getByText(/network down/))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/ui && npm test -- servers
```
Expected: FAIL — `Cannot find module './index.js'`

- [ ] **Step 3: Implement the Servers panel**

```tsx
// packages/ui/src/panels/servers/index.tsx
import { useEffect, useState } from 'react'
import { getServers, subscribeEvents, type ServerStatus } from '../../api/client.js'
import type { Panel } from '../../registry.js'

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

function ServersPanel() {
  const [servers, setServers] = useState<ServerStatus[]>([])
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    getServers().then(setServers).catch(e => setError((e as Error).message))
    return subscribeEvents(event => {
      const e = event as { type: string }
      if (['server_up', 'server_down', 'server_error'].includes(e.type)) {
        getServers().then(setServers).catch(() => {})
      }
    })
  }, [])

  if (error) return <p style={{ color: '#ef4444' }}>Failed to load: {error}</p>
  if (!servers.length) return <p style={{ color: '#6b7280' }}>No servers running.</p>

  return (
    <div>
      <h1 style={{ fontSize: 18, fontWeight: 600, marginBottom: 20 }}>Servers</h1>
      <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ color: '#6b7280', textAlign: 'left', borderBottom: '1px solid #1f2937' }}>
            <th style={{ paddingBottom: 8, paddingRight: 16 }}>Server</th>
            <th style={{ paddingBottom: 8, paddingRight: 16 }}>Status</th>
            <th style={{ paddingBottom: 8, paddingRight: 16 }}>Uptime</th>
            <th style={{ paddingBottom: 8 }}>Last Error</th>
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
              <td style={{ paddingRight: 16, color: '#9ca3af' }}>{formatUptime(s.uptime_ms)}</td>
              <td style={{ color: '#ef4444', fontSize: 11, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.last_error ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export const panel: Panel = {
  id: 'servers',
  label: 'Servers',
  route: '/servers',
  component: ServersPanel,
  order: 1
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/ui && npm test -- servers
```
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/panels/servers/
git commit -m "feat: cockpit Servers panel"
```

---

## Task 7: Call Log panel

**Files:**
- Create: `packages/ui/src/panels/calls/index.tsx`
- Create: `packages/ui/src/panels/calls/calls.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/ui/src/panels/calls/calls.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { panel } from './index.js'
import * as client from '../../api/client.js'

vi.mock('../../api/client.js')

const mockCall: client.ToolCall = {
  id: 1, ts: Date.now(), server_id: 'srv', tool_name: 'read_file',
  duration_ms: 123, input_tokens: null, output_tokens: null,
  success: 1, error_msg: null
}

beforeEach(() => {
  vi.mocked(client.getCalls).mockResolvedValue([mockCall])
  vi.mocked(client.subscribeEvents).mockReturnValue(() => {})
})

describe('CallsPanel', () => {
  it('has correct panel metadata', () => {
    expect(panel.id).toBe('calls')
    expect(panel.label).toBe('Call Log')
    expect(panel.order).toBe(2)
  })

  it('renders tool call rows', async () => {
    render(<MemoryRouter><panel.component /></MemoryRouter>)
    await waitFor(() => screen.getByText('read_file'))
    expect(screen.getByText('123ms')).toBeTruthy()
  })

  it('shows error badge for failed calls', async () => {
    vi.mocked(client.getCalls).mockResolvedValue([
      { ...mockCall, success: 0, error_msg: 'ENOENT' }
    ])
    render(<MemoryRouter><panel.component /></MemoryRouter>)
    await waitFor(() => screen.getByText('error'))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/ui && npm test -- calls
```
Expected: FAIL — `Cannot find module './index.js'`

- [ ] **Step 3: Implement the Call Log panel**

```tsx
// packages/ui/src/panels/calls/index.tsx
import { useEffect, useRef, useState } from 'react'
import { getCalls, subscribeEvents, type ToolCall } from '../../api/client.js'
import type { Panel } from '../../registry.js'

function CallsPanel() {
  const [calls, setCalls]   = useState<ToolCall[]>([])
  const [paused, setPaused] = useState(false)
  const [error, setError]   = useState<string | null>(null)
  const pausedRef = useRef(paused)
  pausedRef.current = paused

  useEffect(() => {
    getCalls({ limit: 200 }).then(setCalls).catch(e => setError((e as Error).message))
    return subscribeEvents(event => {
      const e = event as { type: string; data: ToolCall }
      if (e.type === 'tool_call' && !pausedRef.current) {
        setCalls(prev => [e.data, ...prev].slice(0, 200))
      }
    })
  }, [])

  if (error) return <p style={{ color: '#ef4444' }}>Failed to load: {error}</p>

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <h1 style={{ fontSize: 18, fontWeight: 600 }}>Call Log</h1>
        <button
          onClick={() => setPaused(p => !p)}
          style={{
            padding: '3px 10px', borderRadius: 4, fontSize: 11, cursor: 'pointer',
            background: paused ? '#1f2937' : '#064e3b', color: paused ? '#9ca3af' : '#34d399',
            border: 'none'
          }}
        >
          {paused ? '▶ Resume' : '⏸ Pause'}
        </button>
        <span style={{ color: '#6b7280', fontSize: 12 }}>{calls.length} calls</span>
      </div>
      {calls.length === 0
        ? <p style={{ color: '#6b7280' }}>No tool calls recorded yet.</p>
        : (
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: '#6b7280', textAlign: 'left', borderBottom: '1px solid #1f2937' }}>
                <th style={{ paddingBottom: 8, paddingRight: 12 }}>Time</th>
                <th style={{ paddingBottom: 8, paddingRight: 12 }}>Server</th>
                <th style={{ paddingBottom: 8, paddingRight: 12 }}>Tool</th>
                <th style={{ paddingBottom: 8, paddingRight: 12 }}>Duration</th>
                <th style={{ paddingBottom: 8 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {calls.map(c => (
                <tr key={c.id} style={{ borderBottom: '1px solid #0d1117' }}>
                  <td style={{ padding: '8px 12px 8px 0', color: '#6b7280' }}>
                    {new Date(c.ts).toLocaleTimeString()}
                  </td>
                  <td style={{ paddingRight: 12, fontFamily: 'monospace', color: '#9ca3af' }}>{c.server_id}</td>
                  <td style={{ paddingRight: 12, fontFamily: 'monospace' }}>{c.tool_name}</td>
                  <td style={{ paddingRight: 12, color: '#9ca3af' }}>{c.duration_ms}ms</td>
                  <td>
                    {c.success
                      ? <span style={{ color: '#10b981', fontSize: 11 }}>ok</span>
                      : <span style={{ color: '#ef4444', fontSize: 11 }} title={c.error_msg ?? ''}>error</span>
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      }
    </div>
  )
}

export const panel: Panel = {
  id: 'calls',
  label: 'Call Log',
  route: '/calls',
  component: CallsPanel,
  order: 2
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/ui && npm test -- calls
```
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/panels/calls/
git commit -m "feat: cockpit Call Log panel with live SSE updates"
```

---

## Task 8: Token Usage panel + build integration

**Files:**
- Create: `packages/ui/src/panels/tokens/index.tsx`
- Create: `packages/ui/src/panels/tokens/tokens.test.tsx`
- Modify: root `package.json` (add `build:ui` script)

- [ ] **Step 1: Write the failing test**

```typescript
// packages/ui/src/panels/tokens/tokens.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { panel } from './index.js'
import * as client from '../../api/client.js'

vi.mock('../../api/client.js')

const mockSummary: client.TokenSummary = {
  total_calls: 47,
  total_input_tokens: null,
  total_output_tokens: null,
  top_tool: { name: 'search_code', calls: 23 }
}

const mockDaily: client.DailyBucket[] = [
  { date: '2026-07-01', calls: 12, input_tokens: null },
  { date: '2026-07-02', calls: 35, input_tokens: null }
]

beforeEach(() => {
  vi.mocked(client.getTokenSummary).mockResolvedValue(mockSummary)
  vi.mocked(client.getTokensDaily).mockResolvedValue(mockDaily)
})

describe('TokensPanel', () => {
  it('has correct panel metadata', () => {
    expect(panel.id).toBe('tokens')
    expect(panel.label).toBe('Token Usage')
    expect(panel.order).toBe(3)
  })

  it('shows total call count', async () => {
    render(<MemoryRouter><panel.component /></MemoryRouter>)
    await waitFor(() => screen.getByText('47'))
  })

  it('shows top tool name', async () => {
    render(<MemoryRouter><panel.component /></MemoryRouter>)
    await waitFor(() => screen.getByText('search_code'))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/ui && npm test -- tokens
```
Expected: FAIL — `Cannot find module './index.js'`

- [ ] **Step 3: Implement the Token Usage panel**

```tsx
// packages/ui/src/panels/tokens/index.tsx
import { useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { getTokenSummary, getTokensDaily, type TokenSummary, type DailyBucket } from '../../api/client.js'
import type { Panel } from '../../registry.js'

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ padding: '16px 20px', background: '#111827', borderRadius: 8, minWidth: 140 }}>
      <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700 }}>{value}</div>
    </div>
  )
}

function TokensPanel() {
  const [summary, setSummary] = useState<TokenSummary | null>(null)
  const [daily, setDaily]     = useState<DailyBucket[]>([])
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    Promise.all([getTokenSummary(), getTokensDaily(14)])
      .then(([s, d]) => { setSummary(s); setDaily(d) })
      .catch(e => setError((e as Error).message))
  }, [])

  if (error)   return <p style={{ color: '#ef4444' }}>Failed to load: {error}</p>
  if (!summary) return <p style={{ color: '#6b7280' }}>Loading…</p>

  return (
    <div>
      <h1 style={{ fontSize: 18, fontWeight: 600, marginBottom: 20 }}>Token Usage</h1>

      <div style={{ display: 'flex', gap: 12, marginBottom: 32, flexWrap: 'wrap' }}>
        <Stat label="Total calls" value={summary.total_calls} />
        <Stat
          label="Input tokens (est.)"
          value={summary.total_input_tokens != null ? summary.total_input_tokens.toLocaleString() : '—'}
        />
        <Stat
          label="Top tool"
          value={summary.top_tool?.name ?? '—'}
        />
        {summary.top_tool && (
          <Stat label="Top tool calls" value={summary.top_tool.calls} />
        )}
      </div>

      <h2 style={{ fontSize: 14, fontWeight: 600, color: '#9ca3af', marginBottom: 12 }}>
        Calls per day (last 14 days)
      </h2>
      <p style={{ fontSize: 11, color: '#6b7280', marginBottom: 16 }}>
        Token counts show as — until MCP usage reporting is supported by your servers.
      </p>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={daily} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} />
          <Tooltip
            contentStyle={{ background: '#111827', border: '1px solid #1f2937', fontSize: 12 }}
            labelStyle={{ color: '#9ca3af' }}
          />
          <Bar dataKey="calls" fill="#3b82f6" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export const panel: Panel = {
  id: 'tokens',
  label: 'Token Usage',
  route: '/tokens',
  component: TokensPanel,
  order: 3
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/ui && npm test -- tokens
```
Expected: PASS (3 tests)

- [ ] **Step 5: Add build:ui script to root package.json**

In the root `package.json`, add to `"scripts"`:

```json
"build:ui": "npm run build -w packages/ui && npm run build -w packages/bridge"
```

This ensures the UI is compiled into `packages/bridge/dist/public/` before the Bridge is built, so the static files are embedded.

- [ ] **Step 6: Run full build**

```bash
cd C:\Users\Anwender\IdeaProjects\mcpinv
npm run build:ui
```
Expected: UI compiles to `packages/bridge/dist/public/`, then Bridge TypeScript compiles. No errors.

- [ ] **Step 7: Run all tests across all packages**

```bash
npm test --workspaces
```
Expected: all tests in bridge, cli, and ui PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/ui/src/panels/tokens/ package.json
git commit -m "feat: cockpit Token Usage panel + build:ui script"
```

---

## Self-Review

### Spec coverage

| Spec requirement | Task |
|---|---|
| `packages/ui` React + Vite | Task 5 |
| Panel Registry | Task 5 |
| SQLite schema v1 | Task 1 |
| Bridge writes on every callTool() | Task 2 |
| SSE bus | Task 3 |
| `GET /api/servers` | Task 3 |
| `GET /api/calls` | Task 3 |
| `GET /api/tokens/summary` | Task 3 |
| `GET /api/tokens/daily` | Task 3 |
| `GET /api/events` SSE | Task 3 |
| Static file serving | Task 3 |
| CLI auto-open browser | Task 4 |
| Servers panel | Task 6 |
| Call Log panel | Task 7 |
| Token Usage panel | Task 8 |
| Build integration (UI → bridge/dist/public) | Task 8 |
| Paid-tier extension point (`tier` field in Panel) | Task 5 registry.ts |
| No PII stored (args_hash only) | Task 2 server.ts |

All spec requirements covered. ✓

### Type consistency check

- `Panel` interface defined in `registry.ts` (Task 5), used by all panel exports (Tasks 6–8) ✓
- `ToolCall` interface in `client.ts` matches `ToolCallRow` columns in `db.ts` ✓
- `CockpitEvent` defined in `event-bus.ts` (Task 2), emitted in `server.ts` (Task 2), delivered via SSE in `api-routes.ts` (Task 3), consumed in panels (Tasks 6–7) ✓
- `insertToolCall` takes `Omit<ToolCallRow, 'id'>` consistently ✓
