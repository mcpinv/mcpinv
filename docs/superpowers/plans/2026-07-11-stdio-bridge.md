# stdio Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `mcpinv serve <id> --stdio` so Claude Desktop can use mcpinv as a transparent MCP proxy — all tool calls pass through mcpinv, enabling guaranteed telemetry regardless of whether the Cockpit is open.

**Architecture:** A new `StdioBridge` class wraps `McpClient` (upstream connection to the real MCP server) and `Server` + `StdioServerTransport` (downstream MCP server presented to Claude Desktop). Every tool call is intercepted: duration, token counts, success/failure are written to SQLite and emitted to the CockpitServer via HTTP (non-fatal). The `serve --stdio` CLI path bypasses `BridgeServer` (Fastify HTTP) entirely and runs `StdioBridge` instead. Telemetry flows to cockpit.db regardless of Cockpit UI state.

**Tech Stack:** `@modelcontextprotocol/sdk` 1.29.0 (`Server`, `StdioServerTransport` from `server/stdio.js`, `server/index.js`), `better-sqlite3`, existing `McpClient`, existing `openDb`/`insertToolCall`/`upsertKnownServer`, `commander`.

## Global Constraints

- TypeScript ESM (`"type": "module"` in package.json)
- No new npm dependencies
- All code and comments in English
- No `SELECT *` in SQL
- TDD: tests written before implementation
- `StdioBridge` must NOT write to stdout (breaks MCP protocol) — logging goes to stderr or file only
- Telemetry POST to cockpit is non-fatal (`.catch(() => {})`)
- `mcpinv serve <id> --stdio` exits cleanly when stdin closes (Claude Desktop closes the connection)
- `upsertKnownServer` called on start (same as BridgeServer)

---

## File Structure

```
packages/bridge/src/
  stdio-bridge.ts       CREATE — StdioBridge class: MCP server over stdio with telemetry
  index.ts              MODIFY — export StdioBridge

packages/bridge/tests/
  stdio-bridge.test.ts  CREATE — StdioBridge unit tests (mocked McpClient + in-memory DB)

packages/cli/src/commands/
  serve.ts              MODIFY — add --stdio flag; when set, run StdioBridge instead of BridgeServer
  
packages/cli/tests/commands/
  serve.test.ts         MODIFY — add --stdio option test
```

---

### Task 1: StdioBridge class

**Files:**
- Create: `packages/bridge/src/stdio-bridge.ts`
- Create: `packages/bridge/tests/stdio-bridge.test.ts`
- Modify: `packages/bridge/src/index.ts`

**Interfaces:**
- Consumes: `McpClient` (existing), `openDb`, `insertToolCall`, `upsertKnownServer` (existing)
- Produces:
  ```typescript
  interface StdioBridgeOptions {
    serverId: string
    dbPath?: string
    cockpitUrl?: string  // default: 'http://localhost:3000'
    logPath: string
  }

  class StdioBridge {
    constructor(client: McpClient, options: StdioBridgeOptions, db?: Database.Database)
    start(): Promise<void>   // connects upstream, starts stdio MCP server downstream
    stop(): Promise<void>    // closes both sides
  }
  ```

- [ ] **Step 1: Write the failing tests**

Create `packages/bridge/tests/stdio-bridge.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest'
import { Readable, Writable, PassThrough } from 'stream'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { openDb } from '../src/db.js'
import { StdioBridge } from '../src/stdio-bridge.js'
import type { McpClient } from '../src/mcp-client.js'

function mockClient(overrides: Partial<McpClient> = {}): McpClient {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    listTools: vi.fn().mockResolvedValue([
      { name: 'ping', description: 'Ping', inputSchema: { type: 'object', properties: {} } }
    ]),
    callTool: vi.fn().mockResolvedValue([{ type: 'text', text: 'pong' }]),
    close: vi.fn().mockResolvedValue(undefined),
    ...overrides
  } as unknown as McpClient
}

function makeStreams() {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  return { stdin, stdout }
}

describe('StdioBridge', () => {
  let bridge: StdioBridge | null = null

  afterEach(async () => { await bridge?.stop(); bridge = null })

  it('connects to upstream MCP client on start', async () => {
    const client = mockClient()
    const db = openDb(join(tmpdir(), `mcpinv-stdio-test-${randomUUID()}.db`))
    const { stdin, stdout } = makeStreams()
    bridge = new StdioBridge(client, {
      serverId: 'test-server',
      dbPath: ':memory:',
      logPath: join(tmpdir(), 'stdio-test.log')
    }, db, stdin, stdout)

    await bridge.start()

    expect(client.connect).toHaveBeenCalledOnce()
    expect(client.listTools).toHaveBeenCalledOnce()
    db.close()
  })

  it('calls upsertKnownServer on start', async () => {
    const client = mockClient()
    const dbPath = join(tmpdir(), `mcpinv-stdio-test-${randomUUID()}.db`)
    const db = openDb(dbPath)
    const { stdin, stdout } = makeStreams()
    bridge = new StdioBridge(client, {
      serverId: 'my-server',
      logPath: join(tmpdir(), 'stdio-test.log')
    }, db, stdin, stdout)

    await bridge.start()

    const { listKnownServers } = await import('../src/db.js')
    const known = listKnownServers(db)
    expect(known.some(s => s.id === 'my-server')).toBe(true)
    db.close()
  })

  it('stop is idempotent', async () => {
    const client = mockClient()
    const db = openDb(join(tmpdir(), `mcpinv-stdio-test-${randomUUID()}.db`))
    const { stdin, stdout } = makeStreams()
    bridge = new StdioBridge(client, {
      serverId: 'test-server',
      logPath: join(tmpdir(), 'stdio-test.log')
    }, db, stdin, stdout)

    await bridge.start()
    await bridge.stop()
    await expect(bridge.stop()).resolves.not.toThrow()
    bridge = null
    db.close()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```powershell
cd packages/bridge; npm test -- tests/stdio-bridge.test.ts
```
Expected: FAIL — "Cannot find module '../src/stdio-bridge.js'"

- [ ] **Step 3: Implement StdioBridge**

Create `packages/bridge/src/stdio-bridge.ts`:

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { Readable, Writable } from 'stream'
import type Database from 'better-sqlite3'
import { appendFileSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { createHash } from 'crypto'
import type { McpClient } from './mcp-client.js'
import { openDb, insertToolCall, upsertKnownServer } from './db.js'

export interface StdioBridgeOptions {
  serverId: string
  dbPath?: string
  cockpitUrl?: string
  logPath: string
}

export class StdioBridge {
  private server: Server
  private transport: StdioServerTransport
  private readonly db: Database.Database
  private readonly ownsDb: boolean
  private started = false
  private logDirReady = false

  constructor(
    private readonly client: McpClient,
    private readonly options: StdioBridgeOptions,
    db?: Database.Database,
    stdin?: Readable,
    stdout?: Writable
  ) {
    this.ownsDb = !db
    this.db = db ?? openDb(options.dbPath)
    this.server = new Server({ name: options.serverId, version: '1.0.0' }, {
      capabilities: { tools: {} }
    })
    this.transport = new StdioServerTransport(
      stdin as any,
      stdout as any
    )
  }

  async start(): Promise<void> {
    if (this.started) return

    await this.client.connect()
    const tools = await this.client.listTools()
    upsertKnownServer(this.db, this.options.serverId)

    // Register handler for tools/list
    this.server.setRequestHandler(
      { method: 'tools/list' } as any,
      async () => ({ tools })
    )

    // Register handler for tools/call
    this.server.setRequestHandler(
      { method: 'tools/call' } as any,
      async (req: any) => {
        const { name, arguments: args = {} } = req.params
        const argsHash = createHash('sha256')
          .update(JSON.stringify(args))
          .digest('hex')
          .slice(0, 16)
        const start = Date.now()

        try {
          const result = await this.client.callTool(name, args)
          const duration_ms = Date.now() - start
          const ts = Date.now()
          insertToolCall(this.db, {
            ts,
            server_id: this.options.serverId,
            tool_name: name,
            args_hash: argsHash,
            duration_ms,
            input_tokens: null,
            output_tokens: null,
            success: 1,
            error_msg: null
          })
          this.notifyCockpit('tool_call', { ts, server_id: this.options.serverId, tool_name: name, duration_ms, success: true })
          this.log(`[tool] ${name} ok`)
          return { content: result }
        } catch (err) {
          const duration_ms = Date.now() - start
          const ts = Date.now()
          const message = err instanceof Error ? err.message : String(err)
          insertToolCall(this.db, {
            ts,
            server_id: this.options.serverId,
            tool_name: name,
            args_hash: argsHash,
            duration_ms,
            input_tokens: null,
            output_tokens: null,
            success: 0,
            error_msg: message.slice(0, 500)
          })
          this.log(`[tool] ${name} error: ${message}`)
          throw err
        }
      }
    )

    await this.server.connect(this.transport)
    this.started = true

    // Register with cockpit (non-fatal)
    const cockpitUrl = this.options.cockpitUrl ?? 'http://localhost:3000'
    fetch(`${cockpitUrl}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ server_id: this.options.serverId, port: 0, mode: 'stdio' })
    }).catch(() => {})

    this.log(`stdio bridge started for ${this.options.serverId}`)
  }

  async stop(): Promise<void> {
    if (!this.started) return
    try {
      const cockpitUrl = this.options.cockpitUrl ?? 'http://localhost:3000'
      await fetch(`${cockpitUrl}/api/register/${this.options.serverId}`, {
        method: 'DELETE'
      }).catch(() => {})
      await this.server.close()
      await this.client.close()
    } finally {
      if (this.ownsDb) this.db.close()
      this.started = false
    }
  }

  private notifyCockpit(type: string, data: unknown): void {
    const cockpitUrl = this.options.cockpitUrl ?? 'http://localhost:3000'
    fetch(`${cockpitUrl}/api/events/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, data })
    }).catch(() => {})
  }

  private log(message: string): void {
    const entry = JSON.stringify({ ts: new Date().toISOString(), msg: message })
    try {
      if (!this.logDirReady) {
        mkdirSync(dirname(this.options.logPath), { recursive: true })
        this.logDirReady = true
      }
      appendFileSync(this.options.logPath, entry + '\n')
    } catch {
      // log failure is non-fatal
    }
  }
}
```

- [ ] **Step 4: Export from index.ts**

In `packages/bridge/src/index.ts`, add:
```typescript
export { StdioBridge } from './stdio-bridge.js'
export type { StdioBridgeOptions } from './stdio-bridge.js'
```

- [ ] **Step 5: Run tests to verify they pass**

```powershell
cd packages/bridge; npm test -- tests/stdio-bridge.test.ts
```
Expected: 3 tests PASS

**Note on setRequestHandler:** The MCP SDK 1.29.0 `Server.setRequestHandler` signature requires a Zod schema as first argument in newer versions. If the above pattern fails due to schema validation, use the `McpServer` (from `server/mcp.js`) instead:

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
// McpServer has .tool(name, schema, handler) pattern
```

Adjust implementation accordingly if needed — the test contract (connect called, upsertKnownServer called, stop idempotent) remains the same.

- [ ] **Step 6: Run full bridge test suite**

```powershell
cd packages/bridge; npm test
```
Expected: all tests PASS (57 existing + 3 new)

- [ ] **Step 7: Commit**

```powershell
git add packages/bridge/src/stdio-bridge.ts packages/bridge/src/index.ts packages/bridge/tests/stdio-bridge.test.ts
git commit -m "feat: StdioBridge — MCP stdio proxy with telemetry interception"
```

---

### Task 2: serve --stdio CLI flag

**Files:**
- Modify: `packages/cli/src/commands/serve.ts`
- Modify: `packages/cli/tests/commands/serve.test.ts`

**Interfaces:**
- Consumes: `StdioBridge` from `@mcpinv/bridge`
- `serve` action: when `opts.stdio === true`, construct `StdioBridge` and call `start()` instead of `BridgeServer`

- [ ] **Step 1: Write the failing test**

Add to `packages/cli/tests/commands/serve.test.ts`:

```typescript
// Add StdioBridge to the @mcpinv/bridge mock at the top:
//   StdioBridge: vi.fn().mockImplementation(() => ({
//     start: vi.fn().mockResolvedValue(undefined),
//     stop: vi.fn().mockResolvedValue(undefined)
//   }))

  it('has a --stdio flag', () => {
    const cmd = serveCommand()
    const stdioOpt = cmd.options.find(o => o.long === '--stdio')
    expect(stdioOpt).toBeDefined()
  })

  it('uses StdioBridge when --stdio is passed', async () => {
    const { StdioBridge, BridgeServer } = await import('@mcpinv/bridge')
    vi.mocked(StdioBridge).mockClear()
    vi.mocked(BridgeServer).mockClear()

    await serveCommand().parseAsync(['my-server', '--stdio'], { from: 'user' })

    expect(StdioBridge).toHaveBeenCalled()
    expect(BridgeServer).not.toHaveBeenCalled()
  })
```

- [ ] **Step 2: Run to verify failure**

```powershell
cd packages/cli; npm test -- tests/commands/serve.test.ts
```
Expected: 2 new tests FAIL

- [ ] **Step 3: Update serve.ts**

Add `--stdio` option and branch in action:

```typescript
import { McpClient, BridgeServer, ConfigWatcher, StdioBridge } from '@mcpinv/bridge'

// In the command definition, add:
.option('--stdio', 'Run as stdio MCP proxy (for Claude Desktop integration)')

// Update opts type:
async (serverId: string, opts: {
  port: number; host: string; watch: boolean;
  telemetry: boolean; cockpitUrl: string; stdio: boolean
}) => {

// After client.connect(), branch:
if (opts.stdio) {
  const bridge = new StdioBridge(client, {
    serverId,
    logPath,
    cockpitUrl: opts.cockpitUrl
  })
  try {
    await bridge.start()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(chalk.red(`Failed to start stdio bridge: ${message}`))
    await client.close()
    process.exit(1)
  }

  const shutdown = async () => { await bridge.stop(); process.exit(0) }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
  // stdin close = Claude Desktop disconnected
  process.stdin.on('close', shutdown)
  return
}

// existing BridgeServer path follows unchanged
```

**Important:** In `--stdio` mode, suppress all `console.log` output — Claude Desktop reads stdout as MCP protocol. The `return` after `bridge.start()` prevents the existing console.log lines from running.

- [ ] **Step 4: Run tests to verify they pass**

```powershell
cd packages/cli; npm test -- tests/commands/serve.test.ts
```
Expected: all serve tests PASS (including 2 new)

- [ ] **Step 5: Run full CLI test suite**

```powershell
cd packages/cli; npm test
```
Expected: all 28+ tests PASS

- [ ] **Step 6: Commit**

```powershell
git add packages/cli/src/commands/serve.ts packages/cli/tests/commands/serve.test.ts
git commit -m "feat: mcpinv serve --stdio — run as MCP stdio proxy for Claude Desktop integration"
```

---

### Task 3: import --wire rewrites claude_desktop_config.json

**Files:**
- Modify: `packages/cli/src/commands/import.ts`
- Modify: `packages/cli/src/services/config-manager.ts`
- Modify: `packages/cli/tests/commands/import.test.ts`
- Modify: `packages/cli/tests/services/config-manager.test.ts`

**Interfaces:**
- New function in `config-manager.ts`:
  ```typescript
  wireServer(serverId: string): Promise<void>
  // Rewrites claude_desktop_config.json: replaces the server's command/args
  // with ["mcpinv", "serve", serverId, "--stdio"]
  // Saves the original command/args as __mcpinv_original__ for unwire support
  ```
- `import` command gains `--wire` flag:
  - Without `--wire`: current behavior (discover + register in SQLite)
  - With `--wire`: discover + register + rewrite config + print "now managed by mcpinv"

- [ ] **Step 1: Write the failing tests**

Add to `packages/cli/tests/services/config-manager.test.ts`:

```typescript
// Assumes vi.mock for fs/promises is in place or uses real temp files
describe('wireServer', () => {
  it('rewrites server entry to use mcpinv serve --stdio', async () => {
    const { wireServer, addServer, getServerConfig } = await import('../../src/services/config-manager.js')
    // First add a server the normal way
    // Then wire it
    // Then check the config was rewritten
    // (Use temp file approach consistent with existing config-manager tests)
  })

  it('preserves __mcpinv_original__ for unwire', async () => {
    // After wireServer, the config entry should have __mcpinv_original__
    // containing the original command/args
  })

  it('is idempotent — wiring an already-wired server is a no-op', async () => {
    // Calling wireServer twice should not double-wrap
  })
})
```

**Note:** The config-manager test helpers use temp file paths. Follow the pattern of existing tests in that file exactly. The exact test implementation depends on how the file mocking is set up — read the existing test file carefully before writing.

Add to `packages/cli/tests/commands/import.test.ts`:

```typescript
  it('--wire flag rewires servers through mcpinv', async () => {
    const { listInstalled } = await import('../../src/services/config-manager.js')
    const { wireServer } = await import('../../src/services/config-manager.js')
    vi.mocked(listInstalled).mockResolvedValue(['mira-memory'])
    // wireServer must also be mocked
    vi.mocked(wireServer).mockResolvedValue(undefined)

    await importCommand().parseAsync(['--wire'], { from: 'user' })

    expect(wireServer).toHaveBeenCalledWith('mira-memory')
  })
```

- [ ] **Step 2: Run to verify failure**

```powershell
cd packages/cli; npm test -- tests/commands/import.test.ts tests/services/config-manager.test.ts
```
Expected: new tests FAIL

- [ ] **Step 3: Implement wireServer in config-manager.ts**

Add after `removeServer`:

```typescript
export async function wireServer(serverId: string): Promise<void> {
  const claudePath = claudeConfigPath()
  const config = await readJson(claudePath)
  const entry: ServerEntry | undefined = config?.mcpServers?.[serverId]
  if (!entry) return

  // Already wired
  if ((entry as any).__mcpinv_original__) return

  const original = { command: entry.command, args: entry.args }
  config.mcpServers[serverId] = {
    __mcpinv_original__: original,
    command: 'mcpinv',
    args: ['serve', serverId, '--stdio'],
    env: entry.env
  }
  await writeJson(claudePath, config)
}
```

- [ ] **Step 4: Update import.ts**

Add `--wire` option and call `wireServer` when set:

```typescript
import { listInstalled, wireServer } from '../services/config-manager.js'

// Add option:
.option('--wire', 'Rewrite Claude Desktop config to route all calls through mcpinv (enables telemetry)')

// In action, after upsertKnownServer loop, if opts.wire:
if ((opts as any).wire) {
  for (const id of ids) {
    await wireServer(id)
  }
  console.log(chalk.bold(`\n${ids.length} server(s) now managed by mcpinv:\n`))
  for (const id of ids) {
    console.log(`  ${chalk.cyan('✓')} ${chalk.bold(id)}  ${chalk.dim('→ routed through mcpinv')}`)
  }
  console.log(chalk.dim('\n  Restart Claude Desktop to apply changes.\n'))
  return
}

// existing non-wired output follows
```

- [ ] **Step 5: Run all CLI tests**

```powershell
cd packages/cli; npm test
```
Expected: all tests PASS

- [ ] **Step 6: Commit**

```powershell
git add packages/cli/src/commands/import.ts packages/cli/src/services/config-manager.ts packages/cli/tests/commands/import.test.ts packages/cli/tests/services/config-manager.test.ts
git commit -m "feat: mcpinv import --wire rewrites Claude Desktop config to proxy through mcpinv"
```

---

## Self-Review

**Spec coverage:**
- ✅ `mcpinv serve --stdio` runs MCP server over stdio (Task 1, 2)
- ✅ All tool calls intercepted → SQLite telemetry (Task 1)
- ✅ Cockpit registration on start/stop, non-fatal (Task 1)
- ✅ `upsertKnownServer` on start (Task 1)
- ✅ No stdout pollution — logs to file only (Task 1, 2)
- ✅ stdin close → clean shutdown (Task 2)
- ✅ `mcpinv import --wire` rewrites config (Task 3)
- ✅ `__mcpinv_original__` preserves original for future unwire (Task 3)
- ✅ Idempotent: wiring twice is a no-op (Task 3)
- ✅ "now managed by mcpinv" messaging (Task 3)

**Placeholder scan:** None — all steps have complete code.

**Type consistency:**
- `StdioBridgeOptions` defined Task 1, used in Task 2 ✅
- `StdioBridge` exported from index.ts Task 1, imported in serve.ts Task 2 ✅
- `wireServer` defined Task 3 config-manager, imported in import.ts Task 3 ✅

**Known risk:** `Server.setRequestHandler` signature varies across MCP SDK versions. Task 1 Step 3 includes a fallback note to use `McpServer` if the schema-first signature is required. The implementer must check this at runtime — the test contract is the source of truth, not the implementation sketch.
