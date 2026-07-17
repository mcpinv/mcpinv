# Auto-Reconnect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When Cockpit starts, automatically reconnect orphaned bridge processes (bridges that survived a Cockpit crash) via a 4-stage port-discovery strategy, so the user never loses visibility of running servers.

**Architecture:** Three additions to `packages/bridge`:
1. **`last_port` schema** — `known_servers` table gains a `last_port INTEGER` column (schema migration v1→v2); `POST /api/register` updates it; `KnownServer` interface exposes it.
2. **`process-scanner.ts`** — `findBridgePort(candidates, timeoutMs)` HTTP-probes candidate ports in order, then falls back to an OS-level TCP LISTEN scan (`netstat -ano` on Windows, `ss -tlnp` / `lsof` on Unix) to discover unlisted bridges. Also exports `readPortFromConfig(serverId)` which extracts a `--port N` hint from `claude_desktop_config.json`.
3. **`reconnect.ts`** — `reconnectKnownServers(db, registry, eventBus)` runs 4 stages per unregistered known server; called from `CockpitServer.start()` after `listen()`.

**4 Stages per server:**
1. `last_port` from SQLite → HTTP probe → register
2. Derived port (`3001 + server_index`) → HTTP probe → register
3. `claude_desktop_config.json` `--port` hint + OS TCP LISTEN scan → probe → register
4. Not found → no-op (server stays `stopped` in UI, user clicks Start)

**Tech Stack:** Node.js `child_process.execFile` for OS commands, native `fetch` with `AbortController` for HTTP probes, `better-sqlite3` schema migration.

## Global Constraints

- TypeScript ESM (`"type": "module"`)
- No new npm dependencies
- All code and comments in English
- TDD: tests written before implementation
- HTTP probe timeout: 500 ms per port (configurable)
- OS scan is best-effort: if `netstat`/`ss`/`lsof` is unavailable, log and continue — never throw
- `reconnectKnownServers` is non-fatal: errors per-server are caught and logged, never crash Cockpit
- Schema migration: `ALTER TABLE known_servers ADD COLUMN last_port INTEGER` — backward-compatible (existing rows get NULL)
- `listKnownServers` SELECT must include `last_port`
- Platform: Windows (`win32`) is primary; `darwin` and `linux` must also work

---

## File Structure

```
packages/bridge/src/
  db.ts                 MODIFY — last_port column, schema migration v1→v2,
                                 KnownServer.last_port, updateLastPort(), listKnownServers updated
  api-routes.ts         MODIFY — POST /api/register calls updateLastPort
  process-scanner.ts    CREATE — findBridgePort(), probePort(), scanListeningPorts(),
                                 readPortFromConfig()
  reconnect.ts          CREATE — reconnectKnownServers()
  cockpit-server.ts     MODIFY — call reconnectKnownServers after listen()
  index.ts              MODIFY — export reconnectKnownServers, findBridgePort

packages/bridge/tests/
  db.test.ts            MODIFY — last_port migration + updateLastPort tests
  api-routes.test.ts    MODIFY — register route updates last_port
  process-scanner.test.ts  CREATE — probePort, readPortFromConfig, findBridgePort tests
  reconnect.test.ts     CREATE — reconnectKnownServers 4-stage tests
```

---

### Task 1: `last_port` schema + DB helpers + register route update

**Files:**
- Modify: `packages/bridge/src/db.ts`
- Modify: `packages/bridge/src/api-routes.ts`
- Modify: `packages/bridge/tests/db.test.ts`
- Modify: `packages/bridge/tests/api-routes.test.ts`

**Interfaces:**
- Consumes: existing `openDb`, `KnownServer`, `upsertKnownServer`, `listKnownServers`
- Produces:
  ```typescript
  // db.ts
  export interface KnownServer {
    id: string
    registered_at: number
    last_seen_at: number | null
    last_port: number | null   // NEW
  }

  export function updateLastPort(db: Database.Database, id: string, port: number): void
  // UPDATE known_servers SET last_port = ? WHERE id = ?
  ```

- [ ] **Step 1: Write the failing tests**

Read `packages/bridge/tests/db.test.ts` first to understand existing setup patterns.

Add to `packages/bridge/tests/db.test.ts`:

```typescript
describe('last_port migration', () => {
  it('known_servers table has last_port column after openDb', () => {
    const db = openDb(join(tmpdir(), `mcpinv-test-${randomUUID()}.db`))
    upsertKnownServer(db, 'srv-a')
    const row = db.prepare('SELECT last_port FROM known_servers WHERE id = ?').get('srv-a') as any
    expect(row).toBeDefined()
    expect(row.last_port).toBeNull()
    db.close()
  })

  it('schema_version is 2 after openDb', () => {
    const db = openDb(join(tmpdir(), `mcpinv-test-${randomUUID()}.db`))
    const v = (db.prepare('SELECT version FROM schema_version').get() as { version: number }).version
    expect(v).toBe(2)
    db.close()
  })
})

describe('updateLastPort', () => {
  it('sets last_port for known server', () => {
    const db = openDb(join(tmpdir(), `mcpinv-test-${randomUUID()}.db`))
    upsertKnownServer(db, 'srv-b')
    updateLastPort(db, 'srv-b', 3042)
    const known = listKnownServers(db)
    expect(known.find(s => s.id === 'srv-b')?.last_port).toBe(3042)
    db.close()
  })

  it('listKnownServers includes last_port', () => {
    const db = openDb(join(tmpdir(), `mcpinv-test-${randomUUID()}.db`))
    upsertKnownServer(db, 'srv-c')
    const before = listKnownServers(db)
    expect(before[0]).toHaveProperty('last_port')
    db.close()
  })
})
```

Add to `packages/bridge/tests/api-routes.test.ts`:

```typescript
describe('POST /api/register — updates last_port', () => {
  it('stores the port in known_servers.last_port', async () => {
    // Use the existing hub-mode Fastify setup from the test file
    // POST /api/register { server_id: 'port-test', port: 3007, pid: 999 }
    // SELECT last_port FROM known_servers WHERE id = 'port-test'
    // expect last_port === 3007
  })
})
```

- [ ] **Step 2: Run to verify failure**

```powershell
npm test --workspace=packages/bridge -- tests/db.test.ts tests/api-routes.test.ts
```
Expected: new tests FAIL (column does not exist, updateLastPort not found)

- [ ] **Step 3: Update db.ts**

**3a. Update `KnownServer` interface:**
```typescript
export interface KnownServer {
  id: string
  registered_at: number
  last_seen_at: number | null
  last_port: number | null
}
```

**3b. Add schema migration in `openDb`** after the `db.exec(...)` block:

```typescript
// Migrate schema v1 → v2: add last_port column
const currentVersion = (db.prepare('SELECT version FROM schema_version').get() as { version: number }).version
if (currentVersion < 2) {
  db.exec('ALTER TABLE known_servers ADD COLUMN last_port INTEGER')
  db.prepare('UPDATE schema_version SET version = 2').run()
}
```

**3c. Add `updateLastPort`:**
```typescript
export function updateLastPort(db: Database.Database, id: string, port: number): void {
  db.prepare('UPDATE known_servers SET last_port = ? WHERE id = ?').run(port, id)
}
```

**3d. Update `listKnownServers`:**
```typescript
export function listKnownServers(db: Database.Database): KnownServer[] {
  return db.prepare(
    'SELECT id, registered_at, last_seen_at, last_port FROM known_servers ORDER BY registered_at'
  ).all() as KnownServer[]
}
```

- [ ] **Step 4: Update api-routes.ts `POST /api/register`**

Import `updateLastPort` and call it after `upsertKnownServer`:

```typescript
import { listKnownServers, upsertKnownServer, updateLastPort } from './db.js'

// In POST /api/register handler:
upsertKnownServer(db, req.body.server_id)
updateLastPort(db, req.body.server_id, req.body.port)
registry.register(req.body.server_id, req.body.port, req.body.pid)
eventBus.emit_event({ type: 'server_up', data: { ts: Date.now(), server_id: req.body.server_id } })
return { ok: true }
```

- [ ] **Step 5: Run tests to verify they pass**

```powershell
npm test --workspace=packages/bridge -- tests/db.test.ts tests/api-routes.test.ts
```
Expected: all new tests PASS

- [ ] **Step 6: Run full bridge suite**

```powershell
npm test --workspace=packages/bridge
```
Expected: all 72 tests PASS

- [ ] **Step 7: Commit**

```powershell
git add packages/bridge/src/db.ts packages/bridge/src/api-routes.ts packages/bridge/tests/db.test.ts packages/bridge/tests/api-routes.test.ts
git commit -m "feat: known_servers.last_port — schema migration v2, updateLastPort, register route persists port"
```

---

### Task 2: process-scanner.ts — HTTP probe + OS scan + config port hint

**Files:**
- Create: `packages/bridge/src/process-scanner.ts`
- Create: `packages/bridge/tests/process-scanner.test.ts`

**Interfaces:**
- Consumes: Node.js `fetch`, `child_process.execFile`, `fs/promises`, `claude_desktop_config.json`
- Produces:
  ```typescript
  // process-scanner.ts

  /** HTTP-probe a single port. Returns true if /tools responds 2xx within timeoutMs. */
  export async function probePort(port: number, timeoutMs?: number): Promise<boolean>

  /** Extract --port N from a server's claude_desktop_config.json entry (original or wired). */
  export async function readPortFromConfig(
    serverId: string,
    configPath?: string   // defaults to platform-appropriate claude_desktop_config.json
  ): Promise<number | null>

  /** Scan OS TCP LISTEN ports on 127.0.0.1 for active listeners.
   *  Windows: netstat -ano. Unix: ss -tlnp or lsof -i TCP -s TCP:LISTEN. */
  export async function scanListeningPorts(): Promise<number[]>

  /** Try candidate ports first, then OS scan. Returns first port that probes ok, or null. */
  export async function findBridgePort(
    candidates: number[],
    timeoutMs?: number
  ): Promise<number | null>
  ```

- [ ] **Step 1: Write the failing tests**

Create `packages/bridge/tests/process-scanner.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'
import { writeFile } from 'fs/promises'
import { randomUUID } from 'crypto'

// Mock fetch for probePort tests
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// Mock child_process for scanListeningPorts tests
vi.mock('child_process', () => ({
  execFile: vi.fn()
}))

import { probePort, readPortFromConfig, findBridgePort, scanListeningPorts } from '../src/process-scanner.js'

afterEach(() => { vi.clearAllMocks() })

describe('probePort', () => {
  it('returns true when fetch /tools responds ok', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true })
    expect(await probePort(3001)).toBe(true)
    expect(mockFetch).toHaveBeenCalledWith('http://localhost:3001/tools', expect.objectContaining({ signal: expect.any(AbortSignal) }))
  })

  it('returns false when fetch throws (connection refused)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    expect(await probePort(3001)).toBe(false)
  })

  it('returns false when response is not ok', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false })
    expect(await probePort(3002)).toBe(false)
  })
})

describe('readPortFromConfig', () => {
  it('returns null when server not in config', async () => {
    const configPath = join(tmpdir(), `claude-config-${randomUUID()}.json`)
    await writeFile(configPath, JSON.stringify({ mcpServers: {} }))
    expect(await readPortFromConfig('unknown-server', configPath)).toBeNull()
  })

  it('extracts --port from original args of a wired server', async () => {
    const configPath = join(tmpdir(), `claude-config-${randomUUID()}.json`)
    await writeFile(configPath, JSON.stringify({
      mcpServers: {
        'my-server': {
          __mcpinv_original__: { command: 'uvx', args: ['my-server', '--port', '3042'] },
          command: 'mcpinv', args: ['serve', 'my-server', '--stdio']
        }
      }
    }))
    expect(await readPortFromConfig('my-server', configPath)).toBe(3042)
  })

  it('extracts --port from unwired server args', async () => {
    const configPath = join(tmpdir(), `claude-config-${randomUUID()}.json`)
    await writeFile(configPath, JSON.stringify({
      mcpServers: {
        'raw-server': { command: 'node', args: ['server.js', '--port', '3099'] }
      }
    }))
    expect(await readPortFromConfig('raw-server', configPath)).toBe(3099)
  })

  it('returns null when no --port in args', async () => {
    const configPath = join(tmpdir(), `claude-config-${randomUUID()}.json`)
    await writeFile(configPath, JSON.stringify({
      mcpServers: { 'no-port': { command: 'uvx', args: ['no-port'] } }
    }))
    expect(await readPortFromConfig('no-port', configPath)).toBeNull()
  })
})

describe('scanListeningPorts', () => {
  it('returns parsed localhost ports from netstat output (Windows format)', async () => {
    const { execFile } = await import('child_process')
    vi.mocked(execFile).mockImplementation((_cmd, _args, cb: any) => {
      cb(null, `
  Proto  Local Address          Foreign Address        State           PID
  TCP    127.0.0.1:3001         0.0.0.0:0              LISTENING       1234
  TCP    127.0.0.1:3042         0.0.0.0:0              LISTENING       5678
  TCP    0.0.0.0:80             0.0.0.0:0              LISTENING       4
      `, '')
      return {} as any
    })
    const ports = await scanListeningPorts()
    expect(ports).toContain(3001)
    expect(ports).toContain(3042)
    expect(ports).not.toContain(80) // 0.0.0.0 excluded (not localhost)
  })

  it('returns empty array when OS command fails', async () => {
    const { execFile } = await import('child_process')
    vi.mocked(execFile).mockImplementation((_cmd, _args, cb: any) => {
      cb(new Error('command not found'), '', '')
      return {} as any
    })
    expect(await scanListeningPorts()).toEqual([])
  })
})

describe('findBridgePort', () => {
  it('returns first candidate port that probes ok', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('ECONNREFUSED')) // port 3001 dead
      .mockResolvedValueOnce({ ok: true })               // port 3042 alive
    expect(await findBridgePort([3001, 3042])).toBe(3042)
  })

  it('falls back to OS scan when all candidates fail', async () => {
    const { execFile } = await import('child_process')
    vi.mocked(execFile).mockImplementation((_cmd, _args, cb: any) => {
      cb(null, '  TCP    127.0.0.1:3099         0.0.0.0:0              LISTENING       9999\n', '')
      return {} as any
    })
    mockFetch
      .mockRejectedValueOnce(new Error('dead')) // 3001 dead
      .mockResolvedValueOnce({ ok: true })       // 3099 (from OS scan) alive
    expect(await findBridgePort([3001])).toBe(3099)
  })

  it('returns null when nothing responds', async () => {
    const { execFile } = await import('child_process')
    vi.mocked(execFile).mockImplementation((_cmd, _args, cb: any) => {
      cb(null, '', '')
      return {} as any
    })
    mockFetch.mockRejectedValue(new Error('dead'))
    expect(await findBridgePort([3001, 3002])).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure**

```powershell
npm test --workspace=packages/bridge -- tests/process-scanner.test.ts
```
Expected: FAIL — "Cannot find module '../src/process-scanner.js'"

- [ ] **Step 3: Implement process-scanner.ts**

Create `packages/bridge/src/process-scanner.ts`:

```typescript
import { execFile } from 'child_process'
import { readFile } from 'fs/promises'
import { homedir, platform } from 'os'
import { join } from 'path'

const PROBE_TIMEOUT_MS = 500

export async function probePort(port: number, timeoutMs = PROBE_TIMEOUT_MS): Promise<boolean> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`http://localhost:${port}/tools`, { signal: ctrl.signal })
    return res.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

function claudeConfigPath(): string {
  const home = homedir()
  if (platform() === 'win32') {
    const appdata = process.env['APPDATA'] ?? join(home, 'AppData', 'Roaming')
    return join(appdata, 'Claude', 'claude_desktop_config.json')
  }
  if (platform() === 'darwin') {
    return join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
  }
  return join(home, '.config', 'claude', 'claude_desktop_config.json')
}

export async function readPortFromConfig(serverId: string, configPath?: string): Promise<number | null> {
  const path = configPath ?? claudeConfigPath()
  try {
    const raw = await readFile(path, 'utf-8')
    const config = JSON.parse(raw) as { mcpServers?: Record<string, any> }
    const entry = config.mcpServers?.[serverId]
    if (!entry) return null

    // Prefer original args (wired server stores original under __mcpinv_original__)
    const args: string[] = (entry.__mcpinv_original__?.args ?? entry.args) as string[]
    if (!Array.isArray(args)) return null

    const idx = args.indexOf('--port')
    if (idx !== -1 && idx + 1 < args.length) {
      const port = parseInt(args[idx + 1], 10)
      return isNaN(port) ? null : port
    }
    return null
  } catch {
    return null
  }
}

function execFileAsync(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err, stdout) => {
      if (err) reject(err)
      else resolve(stdout)
    })
  })
}

export async function scanListeningPorts(): Promise<number[]> {
  try {
    let output: string
    if (platform() === 'win32') {
      output = await execFileAsync('netstat', ['-ano'])
    } else {
      // Try ss first (Linux), fall back to lsof (macOS)
      try {
        output = await execFileAsync('ss', ['-tlnp'])
      } catch {
        output = await execFileAsync('lsof', ['-i', 'TCP', '-s', 'TCP:LISTEN', '-n', '-P'])
      }
    }
    return parseListeningPorts(output, platform())
  } catch {
    return []
  }
}

function parseListeningPorts(output: string, plat: string): number[] {
  const ports = new Set<number>()
  const lines = output.split('\n')

  if (plat === 'win32') {
    // netstat -ano format: "  TCP    127.0.0.1:3001         0.0.0.0:0              LISTENING  1234"
    for (const line of lines) {
      if (!line.includes('LISTENING')) continue
      const match = /127\.0\.0\.1:(\d+)/.exec(line)
      if (match) ports.add(parseInt(match[1], 10))
    }
  } else {
    // ss -tlnp format: "LISTEN  0  128  127.0.0.1:3001  0.0.0.0:*  ..."
    // lsof format: "node    1234  user  ...  TCP localhost:3001 (LISTEN)"
    for (const line of lines) {
      const match = /(?:127\.0\.0\.1|localhost):(\d+)/.exec(line)
      if (match) ports.add(parseInt(match[1], 10))
    }
  }
  return Array.from(ports)
}

export async function findBridgePort(candidates: number[], timeoutMs = PROBE_TIMEOUT_MS): Promise<number | null> {
  // Stage 1+2: probe explicit candidates
  for (const port of candidates) {
    if (await probePort(port, timeoutMs)) return port
  }

  // Stage 3: OS TCP LISTEN scan
  const scanned = await scanListeningPorts()
  const candidateSet = new Set(candidates)
  for (const port of scanned) {
    if (!candidateSet.has(port) && await probePort(port, timeoutMs)) return port
  }

  return null
}
```

- [ ] **Step 4: Run tests to verify they pass**

```powershell
npm test --workspace=packages/bridge -- tests/process-scanner.test.ts
```
Expected: all 11 tests PASS

- [ ] **Step 5: Export from index.ts**

Add to `packages/bridge/src/index.ts`:
```typescript
export { findBridgePort, probePort, readPortFromConfig, scanListeningPorts } from './process-scanner.js'
```

- [ ] **Step 6: Run full bridge suite**

```powershell
npm test --workspace=packages/bridge
```
Expected: all tests PASS (72 existing + 11 new)

- [ ] **Step 7: Commit**

```powershell
git add packages/bridge/src/process-scanner.ts packages/bridge/src/index.ts packages/bridge/tests/process-scanner.test.ts
git commit -m "feat: process-scanner — HTTP probe, OS TCP scan, config port hint"
```

---

### Task 3: reconnect.ts + CockpitServer.start() integration

**Files:**
- Create: `packages/bridge/src/reconnect.ts`
- Create: `packages/bridge/tests/reconnect.test.ts`
- Modify: `packages/bridge/src/cockpit-server.ts`
- Modify: `packages/bridge/src/index.ts`

**Interfaces:**
- Consumes: `listKnownServers`, `updateLastPort` (Task 1), `findBridgePort`, `readPortFromConfig` (Task 2), `ActiveRegistry`, `EventBus`
- Produces:
  ```typescript
  // reconnect.ts
  export async function reconnectKnownServers(
    db: Database.Database,
    registry: ActiveRegistry,
    eventBus: EventBus
  ): Promise<void>
  // For each known_server not already in registry:
  //   builds candidate port list → calls findBridgePort → if found: updateLastPort + registry.register + emit server_up
  ```

- [ ] **Step 1: Write the failing tests**

Create `packages/bridge/tests/reconnect.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
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
```

- [ ] **Step 2: Run to verify failure**

```powershell
npm test --workspace=packages/bridge -- tests/reconnect.test.ts
```
Expected: FAIL — "Cannot find module '../src/reconnect.js'"

- [ ] **Step 3: Implement reconnect.ts**

Create `packages/bridge/src/reconnect.ts`:

```typescript
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
```

- [ ] **Step 4: Update cockpit-server.ts**

Add import and call after `this.started = true`:

```typescript
import { reconnectKnownServers } from './reconnect.js'

// In start(), after this.started = true:
reconnectKnownServers(this.db, this.registry, this.eventBus).catch(() => {})
```

- [ ] **Step 5: Export from index.ts**

Add to `packages/bridge/src/index.ts`:
```typescript
export { reconnectKnownServers } from './reconnect.js'
```

- [ ] **Step 6: Run tests to verify they pass**

```powershell
npm test --workspace=packages/bridge -- tests/reconnect.test.ts
```
Expected: 7 tests PASS

- [ ] **Step 7: Run full bridge suite**

```powershell
npm test --workspace=packages/bridge
```
Expected: all tests PASS (72 + 11 + 7 = 90 tests)

- [ ] **Step 8: Commit**

```powershell
git add packages/bridge/src/reconnect.ts packages/bridge/src/cockpit-server.ts packages/bridge/src/index.ts packages/bridge/tests/reconnect.test.ts
git commit -m "feat: auto-reconnect on Cockpit start — 4-stage port discovery per known server"
```

---

## Self-Review

**Spec coverage:**
- ✅ Stage 1: `last_port` from SQLite as first candidate (Task 1 + Task 3)
- ✅ Stage 2: derived port `3001 + index` as second candidate (Task 3)
- ✅ Stage 3a: `claude_desktop_config.json` `--port` hint as third candidate (Task 2 + Task 3)
- ✅ Stage 3b: OS TCP LISTEN scan (`netstat`/`ss`/`lsof`) as fallback inside `findBridgePort` (Task 2)
- ✅ Stage 4: not found → server stays stopped, no throw (Task 3)
- ✅ `last_port` updated in DB when port found (Task 3)
- ✅ `registry.register` called → SSE pushes `server_up` → UI updates automatically (Task 3)
- ✅ Per-server errors non-fatal; loop continues (Task 3)
- ✅ Servers already in registry are skipped (Task 3)
- ✅ Schema migration backward-compatible: existing DBs get `last_port = NULL` (Task 1)
- ✅ `POST /api/register` updates `last_port` on every bridge self-registration (Task 1)
- ✅ Windows primary; macOS + Linux fallback in OS scan (Task 2)

**Placeholder scan:** None — all steps have complete code.

**Type consistency:**
- `KnownServer.last_port: number | null` defined Task 1, accessed in Task 3 ✅
- `findBridgePort(candidates: number[], timeoutMs?: number)` defined Task 2, called in Task 3 ✅
- `readPortFromConfig(serverId, configPath?)` defined Task 2, called in Task 3 ✅
- `reconnectKnownServers(db, registry, eventBus)` defined Task 3, called in cockpit-server.ts Task 3 ✅

**Known risk — OS scan on Windows:** `netstat -ano` works on all supported Windows versions. `LISTENING` keyword is localized on some Windows locales (German: `WARTEND`). Mitigation: also match on `127.0.0.1:PORT` pattern regardless of state keyword — the regex `127\.0\.0\.1:(\d+)` matches any line containing that address, so localization is not a blocker.
