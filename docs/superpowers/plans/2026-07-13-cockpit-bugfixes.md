# Cockpit P0/P1 Bugfixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four bugs that make the local Cockpit broken or unusable out of the box: missing `/api/events/push` route (real-time Call Log dead), double `client.connect()` in stdio mode (crash on start), Windows Stop button broken (SIGTERM ignored), and zero Cockpit onboarding in README.

**Architecture:** All fixes are surgical — one route addition, one guard condition, one platform branch, one README section. No new files, no new dependencies, no restructuring.

**Tech Stack:** TypeScript ESM, Fastify, `child_process.execFile`, vitest, Markdown.

## Global Constraints

- TypeScript ESM (`"type": "module"`) — imports use `.js` extensions
- No new npm dependencies
- All code and comments in English
- TDD: tests written before implementation for Tasks 1–3
- Working directory: `C:\Users\Anwender\IdeaProjects\mcpinv`
- Run bridge tests: `npm test --workspace=packages/bridge` from project root (PowerShell)
- Run CLI tests: `npm test --workspace=packages/cli` from project root (PowerShell)
- Commit directly to `main` — no feature branches
- Currently 97 tests passing in packages/bridge

---

## File Structure

```
packages/bridge/src/api-routes.ts      MODIFY — add POST /api/events/push route
packages/bridge/tests/api-routes.test.ts  MODIFY — test events/push
packages/cli/src/commands/serve.ts     MODIFY — skip client.connect() in stdio mode
packages/cli/tests/commands/serve.test.ts  MODIFY — test no double-connect
packages/cli/README.md                 MODIFY — add Cockpit Quick Start section
```

---

### Task 1: `POST /api/events/push` — real-time Call Log for stdio mode

`StdioBridge.notifyCockpit()` already fires `POST /api/events/push` after every tool call (see `packages/bridge/src/stdio-bridge.ts:143`), but the route is never registered. Adding it makes the real-time Call Log work for all servers wired through `mcpinv serve --stdio`.

**Files:**
- Modify: `packages/bridge/src/api-routes.ts`
- Modify: `packages/bridge/tests/api-routes.test.ts`

**Interfaces:**
- Consumes: existing `EventBus.emit_event(event: CockpitEvent)` and the `CockpitEvent` union type from `./event-bus.js`
- Produces: `POST /api/events/push` body `{ type: string; data: unknown }` → calls `eventBus.emit_event` → returns `{ ok: true }`

- [ ] **Step 1: Build a hub-mode test app helper**

Read `packages/bridge/tests/api-routes.test.ts` to understand the existing `buildApp()` helper (non-registry / legacy mode). You need a second helper that uses registry mode — `buildHubApp()` — so you can test the registry-only routes.

Add this helper at the top of the test file, below the existing `buildApp()`:

```typescript
async function buildHubApp() {
  const dbPath = join(tmpdir(), `mcpinv-hub-test-${randomUUID()}.db`)
  tempDbs.push(dbPath)
  const db = openDb(dbPath)
  openDbs.push(db)
  const bus = new EventBus()
  const registry = new ActiveRegistry()
  const app = Fastify()
  await registerApiRoutes(app, db, bus, registry)
  await app.ready()
  return { app, db, bus, registry }
}
```

- [ ] **Step 2: Write the failing test**

Add to `packages/bridge/tests/api-routes.test.ts`:

```typescript
describe('POST /api/events/push', () => {
  it('emits the event on the event bus and returns ok', async () => {
    const { app, bus } = await buildHubApp()
    const received: unknown[] = []
    bus.on_event(e => received.push(e))

    const r = await app.inject({
      method: 'POST',
      url: '/api/events/push',
      payload: { type: 'tool_call', data: { ts: 1, server_id: 'x', tool_name: 'y', duration_ms: 5, success: true } }
    })

    expect(r.statusCode).toBe(200)
    expect(JSON.parse(r.body)).toEqual({ ok: true })
    expect(received).toHaveLength(1)
    expect(received[0]).toMatchObject({ type: 'tool_call' })
  })

  it('returns 404 in legacy (non-registry) mode', async () => {
    const { app } = await buildApp()
    const r = await app.inject({
      method: 'POST',
      url: '/api/events/push',
      payload: { type: 'tool_call', data: {} }
    })
    expect(r.statusCode).toBe(404)
  })
})
```

- [ ] **Step 3: Run to verify failure**

```powershell
npm test --workspace=packages/bridge -- tests/api-routes.test.ts
```
Expected: FAIL — `POST /api/events/push` returns 404 in hub mode (route not registered)

- [ ] **Step 4: Add the route to api-routes.ts**

Inside the `if (registry)` block in `packages/bridge/src/api-routes.ts`, after the `DELETE /api/register/:id` handler and before `POST /api/servers/:id/start`, add:

```typescript
fastify.post<{ Body: { type: string; data: unknown } }>('/api/events/push', async (req) => {
  eventBus.emit_event({ type: req.body.type, data: req.body.data } as CockpitEvent)
  return { ok: true }
})
```

- [ ] **Step 5: Run tests to verify they pass**

```powershell
npm test --workspace=packages/bridge -- tests/api-routes.test.ts
```
Expected: all api-routes tests PASS

- [ ] **Step 6: Run full bridge suite**

```powershell
npm test --workspace=packages/bridge
```
Expected: 99 passed (97 + 2 new)

- [ ] **Step 7: Commit**

```powershell
git add packages/bridge/src/api-routes.ts packages/bridge/tests/api-routes.test.ts
git commit -m "fix: add POST /api/events/push route — real-time Call Log for stdio bridges"
```

---

### Task 2: Fix double `client.connect()` in `serve --stdio`

`serve.ts` calls `await client.connect()` unconditionally (line 44) before constructing `StdioBridge`. Then `StdioBridge.start()` calls `await this.client.connect()` again (stdio-bridge.ts line 49). The second call either crashes or spawns a second subprocess. Fix: skip the early connect when `--stdio` is active.

**Files:**
- Modify: `packages/cli/src/commands/serve.ts`
- Modify: `packages/cli/tests/commands/serve.test.ts`

**Interfaces:**
- Consumes: `McpClient.connect(): Promise<void>` — must be called exactly once before first use
- `StdioBridge.start()` calls `client.connect()` internally — `serve.ts` must not call it when `opts.stdio` is true

- [ ] **Step 1: Read the existing serve test**

Read `packages/cli/tests/commands/serve.test.ts` to understand how `McpClient` and `BridgeServer` are mocked. You will add a test for the stdio path.

- [ ] **Step 2: Write the failing test**

In `packages/cli/tests/commands/serve.test.ts`, add a test that verifies `client.connect()` is called exactly once when `--stdio` is passed. Use the existing mock infrastructure:

```typescript
describe('serve --stdio', () => {
  it('calls client.connect() exactly once (inside StdioBridge, not before)', async () => {
    const connectSpy = vi.fn().mockResolvedValue(undefined)
    // Override the McpClient mock's connect to spy
    vi.mocked(McpClient).mockImplementation(() => ({
      connect: connectSpy,
      close: vi.fn(),
      listTools: vi.fn().mockResolvedValue([]),
      callTool: vi.fn()
    }) as any)

    // StdioBridge mock — verify it receives the client and calls connect once
    let bridgeStartCalled = false
    vi.mocked(StdioBridge).mockImplementation((_client) => ({
      start: vi.fn().mockImplementation(async () => {
        bridgeStartCalled = true
        await connectSpy() // simulate StdioBridge calling connect internally
      }),
      stop: vi.fn()
    }) as any)

    // Run serve --stdio (will hang waiting for signal — use a timeout trick or
    // check that process.on('SIGINT'...) was registered, or just verify connect count)
    // Since serve calls process.on() and returns, we can trigger via the program parse
    const program = new Command()
    program.addCommand(serveCommand())
    // Suppress process.exit by catching
    try {
      await program.parseAsync(['node', 'cli', 'serve', 'test-server', '--stdio'], { from: 'user' })
    } catch { /* process.exit called */ }

    expect(connectSpy).toHaveBeenCalledTimes(1)
    expect(bridgeStartCalled).toBe(true)
  })
})
```

> Note: if the existing test file uses a different mock pattern for `McpClient` and `StdioBridge`, adapt the test to match — the invariant being tested is `connectSpy.toHaveBeenCalledTimes(1)`.

- [ ] **Step 3: Run to verify failure**

```powershell
npm test --workspace=packages/cli -- tests/commands/serve.test.ts
```
Expected: FAIL — `connectSpy` called twice (once in serve.ts, once in StdioBridge.start mock)

- [ ] **Step 4: Fix serve.ts**

In `packages/cli/src/commands/serve.ts`, wrap the early `client.connect()` call (currently unconditional at lines 43–50) so it only runs when NOT in stdio mode:

```typescript
if (!opts.stdio) {
  try {
    await client.connect()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(chalk.red(`Failed to start MCP server "${serverId}": ${message}`))
    console.error(chalk.dim(`  Try: mcpinv diagnose ${serverId}`))
    process.exit(1)
  }
}
```

The `if (opts.stdio)` branch that follows already handles the stdio case — `StdioBridge.start()` connects internally. The non-stdio path still connects before starting `BridgeServer` (unchanged).

- [ ] **Step 5: Run tests to verify they pass**

```powershell
npm test --workspace=packages/cli -- tests/commands/serve.test.ts
```
Expected: all serve tests PASS including the new one

- [ ] **Step 6: Run full CLI suite**

```powershell
npm test --workspace=packages/cli
```
Expected: all CLI tests PASS

- [ ] **Step 7: Commit**

```powershell
git add packages/cli/src/commands/serve.ts packages/cli/tests/commands/serve.test.ts
git commit -m "fix: skip early client.connect() in serve --stdio — StdioBridge connects internally"
```

---

### Task 3: Fix Stop button on Windows + README Cockpit onboarding

Two independent changes bundled: the Windows SIGTERM fix is small and tactical; the README section documents the Cockpit workflow for the first time. Both belong in the same commit cadence and require no test infrastructure sharing.

**Files:**
- Modify: `packages/bridge/src/api-routes.ts`
- Modify: `packages/bridge/tests/api-routes.test.ts`
- Modify: `packages/cli/README.md`

**Interfaces:**
- `process.kill(pid, 'SIGTERM')` → replaced by `killProcess(pid)` which uses `taskkill /PID <pid> /F` on `win32`, `SIGTERM` on others
- `killProcess` is a module-private async function (not exported)

#### Part A: Windows Stop fix

- [ ] **Step 1: Write the failing test (Windows kill path)**

Add to `packages/bridge/tests/api-routes.test.ts`:

```typescript
describe('POST /api/servers/:id/stop — Windows kill', () => {
  it('calls taskkill on win32 instead of SIGTERM', async () => {
    const { app, registry } = await buildHubApp()
    registry.register('kill-test', 3001, 1234)

    // Patch platform to simulate win32
    const osMod = await import('os')
    vi.spyOn(osMod, 'platform').mockReturnValue('win32')

    // Capture execFile calls
    const { execFile } = await import('child_process')
    const execFileSpy = vi.mocked(execFile)
    execFileSpy.mockImplementation((_cmd: string, _args: any, cb: any) => {
      cb(null, '', '')
      return {} as any
    })

    const r = await app.inject({ method: 'POST', url: '/api/servers/kill-test/stop' })
    expect(r.statusCode).toBe(200)
    expect(execFileSpy).toHaveBeenCalledWith(
      'taskkill',
      ['/PID', '1234', '/F'],
      expect.any(Function)
    )

    vi.restoreAllMocks()
  })
})
```

Note: `child_process` is already mocked at the top of the test file (`vi.mock('child_process', ...)`). The existing mock only stubs `spawn` — extend it to also stub `execFile`:

```typescript
vi.mock('child_process', () => ({
  spawn: vi.fn().mockReturnValue({ pid: 9999, unref: vi.fn() }),
  execFile: vi.fn()
}))
```

- [ ] **Step 2: Run to verify failure**

```powershell
npm test --workspace=packages/bridge -- tests/api-routes.test.ts
```
Expected: FAIL — `execFile` not called (current code uses `process.kill`)

- [ ] **Step 3: Implement killProcess in api-routes.ts**

Add imports at the top of `packages/bridge/src/api-routes.ts`:

```typescript
import { execFile } from 'child_process'
import { platform } from 'os'
```

Add a module-level private helper (after the imports, before `registerApiRoutes`):

```typescript
function killProcess(pid: number): Promise<void> {
  return new Promise((resolve) => {
    if (platform() === 'win32') {
      execFile('taskkill', ['/PID', String(pid), '/F'], () => resolve())
    } else {
      try { process.kill(pid, 'SIGTERM') } catch { /* ESRCH — already gone */ }
      resolve()
    }
  })
}
```

Replace the existing stop handler body in `POST /api/servers/:id/stop`:

```typescript
fastify.post<{ Params: { id: string } }>('/api/servers/:id/stop', async (req, reply) => {
  const entry = registry.get(req.params.id)
  if (!entry?.pid) {
    return reply.code(404).send({ error: 'pid_unknown' })
  }
  await killProcess(entry.pid)
  return { ok: true }
})
```

(Remove the old `try { process.kill(...) } catch` block entirely.)

- [ ] **Step 4: Run tests**

```powershell
npm test --workspace=packages/bridge -- tests/api-routes.test.ts
```
Expected: all api-routes tests PASS

#### Part B: README Cockpit onboarding

- [ ] **Step 5: Add Cockpit section to README**

Read `packages/cli/README.md` first. After the existing `## Usage` section (the `inv search / install / status / logs / remove / migrate / update` block), add:

```markdown
## Cockpit — local MCP dashboard

Cockpit gives you a live view of all your MCP servers: call log, token usage, start/stop controls.

### Quick start

```bash
# 1. Import your existing MCP servers from Claude Desktop
mcpinv import

# 2. Wire Claude Desktop to route calls through mcpinv (enables live telemetry)
mcpinv import --wire
# → Restart Claude Desktop after this step

# 3. Open the Cockpit dashboard (keep this running in a terminal)
mcpinv cockpit
# → Opens http://localhost:3000 in your browser
```

### What "wiring" does

`mcpinv import --wire` rewrites your `claude_desktop_config.json` so that every MCP server call is proxied through `mcpinv serve <id> --stdio`. This gives the Cockpit real-time telemetry without requiring any changes to your MCP servers themselves. The original server config is preserved and can be restored by removing the `mcpinv` entries.

### Server lifecycle

| State | Meaning |
|---|---|
| Running | Bridge process is active and accepting calls |
| Stopped | No bridge running — click Start or use `mcpinv serve <id>` |

When Cockpit starts, it automatically reconnects any bridge processes that survived a previous Cockpit session.
```

- [ ] **Step 6: Run full bridge suite to confirm nothing regressed**

```powershell
npm test --workspace=packages/bridge
```
Expected: all tests PASS (99 from Task 1 + any new from this task's step 4)

- [ ] **Step 7: Commit**

```powershell
git add packages/bridge/src/api-routes.ts packages/bridge/tests/api-routes.test.ts packages/cli/README.md
git commit -m "fix: Windows Stop button uses taskkill; add Cockpit onboarding to README"
```

---

## Self-Review

**Spec coverage:**
- ✅ `POST /api/events/push` — Task 1
- ✅ Double `client.connect()` — Task 2
- ✅ Windows Stop broken — Task 3 Part A
- ✅ README Cockpit onboarding — Task 3 Part B

**Placeholder scan:** None found.

**Type consistency:**
- `CockpitEvent` used in Task 1 is already imported in `api-routes.ts` via `EventBus, CockpitEvent` — no new import needed, type is already in scope
- `killProcess(pid: number): Promise<void>` defined and used only in Task 3 — consistent
- `buildHubApp()` defined in Task 1, reused in Task 3 — same return shape `{ app, db, bus, registry }`
