# mcpinv Bridge MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `packages/bridge` — a local MCP-to-REST sidecar that exposes installed MCP servers as a Fastify HTTP server with auto-generated OpenAPI 3.1 spec, hot-swap on config changes, and a 3-tier AI-guided error diagnosis system.

**Architecture:** `packages/bridge` is a new npm workspace package (`@mcpinv/bridge`) that wraps the `@modelcontextprotocol/sdk` client, generates OpenAPI specs from tool definitions, and exposes them via Fastify. The existing `packages/cli` gains two new commands: `serve` (starts the bridge) and `diagnose` (interactive error assistant). Config watcher uses `fs.watch` to detect newly installed servers and triggers a hot-swap without restarting.

**Tech Stack:** TypeScript/ESM, `@modelcontextprotocol/sdk`, Fastify 4, Zod, axios, inquirer, chalk, vitest

---

## File Map

**New files — packages/bridge:**
```
packages/bridge/
  package.json
  tsconfig.json
  vitest.config.ts
  src/
    index.ts              — public exports
    types.ts              — shared interfaces
    mcp-client.ts         — MCP SDK wrapper (spawn subprocess + tool calls)
    openapi.ts            — pure fn: Tool[] → OpenAPI 3.1 spec object
    server.ts             — Fastify server, routes, logging, restart logic
    config-watcher.ts     — fs.watch wrapper, emits on config change
    diagnose/
      collector.ts        — gather local context (stderr, OS, Node version)
      analyzer.ts         — Tier 1 pattern matching (offline)
      error-db.ts         — Tier 2 lookup/report against errors.mcpinv.dev
      assistant.ts        — Tier 3 streaming Claude dialog
  bin/
    bridge.js             — ESM shebang entry (imports src/index.ts dist)
  tests/
    openapi.test.ts
    mcp-client.test.ts
    server.test.ts
    config-watcher.test.ts
    diagnose/
      collector.test.ts
      analyzer.test.ts
      error-db.test.ts
```

**Modified files — packages/cli:**
```
packages/cli/package.json          — add @mcpinv/bridge workspace dep
packages/cli/src/index.ts          — register serve + diagnose commands
packages/cli/src/services/config-manager.ts  — add getServerConfig()
packages/cli/src/commands/serve.ts — new command
packages/cli/src/commands/diagnose.ts — new command
```

**New files — repo root:**
```
package.json    — workspace root (workspaces: ["packages/*"])
```

---

## Task 1: Monorepo Workspace Setup + packages/bridge Scaffold

**Files:**
- Create: `package.json` (root)
- Create: `packages/bridge/package.json`
- Create: `packages/bridge/tsconfig.json`
- Create: `packages/bridge/vitest.config.ts`
- Create: `packages/bridge/src/index.ts`
- Create: `packages/bridge/src/types.ts`
- Modify: `packages/cli/package.json`

- [ ] **Step 1: Create root workspace package.json**

```json
{
  "name": "mcpinv",
  "private": true,
  "workspaces": ["packages/*"]
}
```

Save to: `package.json`

- [ ] **Step 2: Create packages/bridge/package.json**

```json
{
  "name": "@mcpinv/bridge",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0",
    "axios": "^1.7.2",
    "chalk": "^5.3.0",
    "fastify": "^4.28.0",
    "inquirer": "^10.1.8",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "typescript": "^5.5.0",
    "vitest": "^1.6.0"
  }
}
```

Save to: `packages/bridge/package.json`

- [ ] **Step 3: Create packages/bridge/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

Save to: `packages/bridge/tsconfig.json`

- [ ] **Step 4: Create packages/bridge/vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node'
  }
})
```

Save to: `packages/bridge/vitest.config.ts`

- [ ] **Step 5: Create packages/bridge/src/types.ts**

```typescript
export interface McpClientOptions {
  command: string
  args: string[]
  env?: Record<string, string>
}

export interface BridgeServerOptions {
  serverId: string
  port: number
  host: string
  logPath: string
}

export interface DiagnosisContext {
  serverId: string
  exitCode: number | null
  stderr: string
  os: string
  nodeVersion: string
  hasNodeModules: boolean
}

export interface ErrorPattern {
  cause: string
  suggestion: string
}

export interface ErrorGuide {
  error_sig: string
  server_type: string
  cause: string
  fixes: {
    windows: string[]
    macos: string[]
    linux: string[]
  }
  contributed_by: string
  verified: boolean
}
```

- [ ] **Step 6: Create packages/bridge/src/index.ts**

```typescript
export { McpClient } from './mcp-client.js'
export { generateOpenApiSpec } from './openapi.js'
export { BridgeServer } from './server.js'
export { ConfigWatcher } from './config-watcher.js'
export { collectContext } from './diagnose/collector.js'
export { analyzeLocally } from './diagnose/analyzer.js'
export { lookupError, reportError } from './diagnose/error-db.js'
export { runAssistant } from './diagnose/assistant.js'
export type { McpClientOptions, BridgeServerOptions, DiagnosisContext, ErrorPattern, ErrorGuide } from './types.js'
```

- [ ] **Step 7: Add @mcpinv/bridge to CLI package.json**

Open `packages/cli/package.json` and add to `dependencies`:
```json
"@mcpinv/bridge": "*"
```

- [ ] **Step 8: Install workspace dependencies**

Run from repo root:
```
npm install
```

Expected: `node_modules/@mcpinv/bridge` symlink created, no errors.

- [ ] **Step 9: Commit**

```bash
git add package.json packages/bridge/package.json packages/bridge/tsconfig.json packages/bridge/vitest.config.ts packages/bridge/src/index.ts packages/bridge/src/types.ts packages/cli/package.json package-lock.json
git commit -m "feat: add packages/bridge scaffold with workspace setup"
```

---

## Task 2: MCP Client Wrapper

**Files:**
- Create: `packages/bridge/src/mcp-client.ts`
- Create: `packages/bridge/tests/mcp-client.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/bridge/tests/mcp-client.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    listTools: vi.fn().mockResolvedValue({ tools: [{ name: 'search', description: 'Search', inputSchema: { type: 'object' } }] }),
    callTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'result' }] }),
    close: vi.fn().mockResolvedValue(undefined)
  }))
}))

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: vi.fn().mockImplementation(() => ({}))
}))

import { McpClient } from '../src/mcp-client.js'

describe('McpClient', () => {
  let client: McpClient

  beforeEach(() => {
    client = new McpClient({ command: 'node', args: ['server.js'] })
  })

  it('connects and lists tools', async () => {
    await client.connect()
    const tools = await client.listTools()
    expect(tools).toHaveLength(1)
    expect(tools[0].name).toBe('search')
  })

  it('calls a tool and returns content', async () => {
    await client.connect()
    const result = await client.callTool('search', { query: 'test' })
    expect(result).toEqual([{ type: 'text', text: 'result' }])
  })

  it('closes cleanly', async () => {
    await client.connect()
    await expect(client.close()).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```
cd packages/bridge && npm test -- tests/mcp-client.test.ts
```

Expected: FAIL — `McpClient` not found.

- [ ] **Step 3: Implement mcp-client.ts**

```typescript
// packages/bridge/src/mcp-client.ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import type { McpClientOptions } from './types.js'

export class McpClient {
  private client: Client
  private transport: StdioClientTransport

  constructor(private readonly options: McpClientOptions) {
    this.transport = new StdioClientTransport({
      command: options.command,
      args: options.args,
      env: { ...process.env, ...(options.env ?? {}) } as Record<string, string>
    })
    this.client = new Client({ name: 'mcpinv-bridge', version: '1.0.0' }, {})
  }

  async connect(): Promise<void> {
    await this.client.connect(this.transport)
  }

  async listTools(): Promise<Tool[]> {
    const result = await this.client.listTools()
    return result.tools
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const result = await this.client.callTool({ name, arguments: args })
    return result.content
  }

  async close(): Promise<void> {
    await this.client.close()
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```
cd packages/bridge && npm test -- tests/mcp-client.test.ts
```

Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/bridge/src/mcp-client.ts packages/bridge/tests/mcp-client.test.ts
git commit -m "feat: MCP client wrapper with connect/listTools/callTool/close"
```

---

## Task 3: OpenAPI Generator

**Files:**
- Create: `packages/bridge/src/openapi.ts`
- Create: `packages/bridge/tests/openapi.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/bridge/tests/openapi.test.ts
import { describe, it, expect } from 'vitest'
import { generateOpenApiSpec } from '../src/openapi.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'

const tools: Tool[] = [
  {
    name: 'create_issue',
    description: 'Create a GitHub issue',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        body: { type: 'string' }
      },
      required: ['title']
    }
  },
  {
    name: 'list_repos',
    description: 'List repositories',
    inputSchema: { type: 'object', properties: {} }
  }
]

describe('generateOpenApiSpec', () => {
  it('returns valid OpenAPI 3.1 structure', () => {
    const spec = generateOpenApiSpec('github', tools) as any
    expect(spec.openapi).toBe('3.1.0')
    expect(spec.info.title).toBe('github MCP Bridge')
  })

  it('maps each tool to a POST path', () => {
    const spec = generateOpenApiSpec('github', tools) as any
    expect(spec.paths['/tools/create_issue']).toBeDefined()
    expect(spec.paths['/tools/list_repos']).toBeDefined()
    expect(spec.paths['/tools/create_issue'].post.operationId).toBe('create_issue')
  })

  it('uses tool description as summary', () => {
    const spec = generateOpenApiSpec('github', tools) as any
    expect(spec.paths['/tools/create_issue'].post.summary).toBe('Create a GitHub issue')
  })

  it('inlines inputSchema as requestBody', () => {
    const spec = generateOpenApiSpec('github', tools) as any
    const schema = spec.paths['/tools/create_issue'].post.requestBody.content['application/json'].schema
    expect(schema.properties.title).toEqual({ type: 'string' })
  })

  it('handles empty tool list', () => {
    const spec = generateOpenApiSpec('empty', []) as any
    expect(spec.paths).toEqual({})
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```
cd packages/bridge && npm test -- tests/openapi.test.ts
```

Expected: FAIL — `generateOpenApiSpec` not found.

- [ ] **Step 3: Implement openapi.ts**

```typescript
// packages/bridge/src/openapi.ts
import type { Tool } from '@modelcontextprotocol/sdk/types.js'

export function generateOpenApiSpec(serverId: string, tools: Tool[]): object {
  const paths: Record<string, object> = {}

  for (const tool of tools) {
    paths[`/tools/${tool.name}`] = {
      post: {
        operationId: tool.name,
        summary: tool.description ?? tool.name,
        description: tool.description ?? '',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: tool.inputSchema ?? { type: 'object', properties: {} }
            }
          }
        },
        responses: {
          '200': {
            description: 'Tool result',
            content: { 'application/json': { schema: { type: 'object' } } }
          },
          '400': { description: 'Invalid parameters' },
          '422': { description: 'Tool execution failed' }
        }
      }
    }
  }

  return {
    openapi: '3.1.0',
    info: {
      title: `${serverId} MCP Bridge`,
      description: `REST bridge for the ${serverId} MCP server, powered by mcpinv`,
      version: '1.0.0'
    },
    paths
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```
cd packages/bridge && npm test -- tests/openapi.test.ts
```

Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/bridge/src/openapi.ts packages/bridge/tests/openapi.test.ts
git commit -m "feat: OpenAPI 3.1 generator from MCP tool definitions"
```

---

## Task 4: Fastify HTTP Server

**Files:**
- Create: `packages/bridge/src/server.ts`
- Create: `packages/bridge/tests/server.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/bridge/tests/server.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { BridgeServer } from '../src/server.js'
import type { McpClient } from '../src/mcp-client.js'
import { tmpdir } from 'os'
import { join } from 'path'

const mockTools: Tool[] = [
  { name: 'ping', description: 'Ping', inputSchema: { type: 'object', properties: {} } }
]

function mockClient(overrides: Partial<McpClient> = {}): McpClient {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    listTools: vi.fn().mockResolvedValue(mockTools),
    callTool: vi.fn().mockResolvedValue([{ type: 'text', text: 'pong' }]),
    close: vi.fn().mockResolvedValue(undefined),
    ...overrides
  } as unknown as McpClient
}

describe('BridgeServer', () => {
  let server: BridgeServer
  const opts = { serverId: 'test', port: 3099, host: '127.0.0.1', logPath: join(tmpdir(), 'bridge-test.log') }

  beforeEach(() => {
    server = new BridgeServer(mockClient(), opts)
  })

  afterEach(async () => {
    await server.stop()
  })

  it('starts and serves /openapi.json', async () => {
    await server.start()
    const res = await fetch('http://127.0.0.1:3099/openapi.json')
    const json = await res.json() as any
    expect(json.openapi).toBe('3.1.0')
    expect(json.paths['/tools/ping']).toBeDefined()
  })

  it('serves GET /tools', async () => {
    await server.start()
    const res = await fetch('http://127.0.0.1:3099/tools')
    const json = await res.json() as any
    expect(json.tools[0].name).toBe('ping')
  })

  it('calls a tool via POST /tools/:name', async () => {
    const client = mockClient()
    server = new BridgeServer(client, opts)
    await server.start()
    const res = await fetch('http://127.0.0.1:3099/tools/ping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    })
    expect(res.status).toBe(200)
  })

  it('returns 404 for unknown tool', async () => {
    await server.start()
    const res = await fetch('http://127.0.0.1:3099/tools/unknown', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    })
    expect(res.status).toBe(404)
  })

  it('returns 422 when tool call throws', async () => {
    const client = mockClient({
      callTool: vi.fn().mockRejectedValue(new Error('upstream error'))
    } as any)
    server = new BridgeServer(client, opts)
    await server.start()
    const res = await fetch('http://127.0.0.1:3099/tools/ping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    })
    expect(res.status).toBe(422)
    const json = await res.json() as any
    expect(json.error).toBe('tool_failed')
  })

  it('hot-swaps tools and updates spec', async () => {
    await server.start()
    const newTools: Tool[] = [
      { name: 'ping', description: 'Ping', inputSchema: { type: 'object', properties: {} } },
      { name: 'create_issue', description: 'Create issue', inputSchema: { type: 'object', properties: {} } }
    ]
    server.updateTools(newTools)
    const res = await fetch('http://127.0.0.1:3099/openapi.json')
    const json = await res.json() as any
    expect(json.paths['/tools/create_issue']).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```
cd packages/bridge && npm test -- tests/server.test.ts
```

Expected: FAIL — `BridgeServer` not found.

- [ ] **Step 3: Implement server.ts**

```typescript
// packages/bridge/src/server.ts
import Fastify from 'fastify'
import { appendFileSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import type { McpClient } from './mcp-client.js'
import { generateOpenApiSpec } from './openapi.js'
import type { BridgeServerOptions } from './types.js'

export class BridgeServer {
  private fastify = Fastify({ logger: false })
  private tools: Tool[] = []
  private spec: object = {}
  private started = false

  constructor(
    private readonly client: McpClient,
    private readonly options: BridgeServerOptions
  ) {}

  async start(): Promise<void> {
    this.tools = await this.client.listTools()
    this.spec = generateOpenApiSpec(this.options.serverId, this.tools)
    this.registerRoutes()
    await this.fastify.listen({ port: this.options.port, host: this.options.host })
    this.started = true
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
        try {
          const result = await this.client.callTool(request.params.name, request.body ?? {})
          this.log(`[tool] ${request.params.name} ok`)
          return result
        } catch (err: any) {
          this.log(`[tool] ${request.params.name} error: ${err.message}`)
          return reply.code(422).send({
            error: 'tool_failed',
            message: err.message ?? 'Tool execution failed',
            tool: request.params.name
          })
        }
      }
    )
  }

  private log(message: string): void {
    const entry = JSON.stringify({ ts: new Date().toISOString(), msg: message })
    try {
      mkdirSync(dirname(this.options.logPath), { recursive: true })
      appendFileSync(this.options.logPath, entry + '\n')
    } catch {}
  }

  async stop(): Promise<void> {
    if (this.started) await this.fastify.close()
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```
cd packages/bridge && npm test -- tests/server.test.ts
```

Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/bridge/src/server.ts packages/bridge/tests/server.test.ts
git commit -m "feat: Fastify bridge server with hot-swap support"
```

---

## Task 5: Config Watcher

**Files:**
- Create: `packages/bridge/src/config-watcher.ts`
- Create: `packages/bridge/tests/config-watcher.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/bridge/tests/config-watcher.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { ConfigWatcher } from '../src/config-watcher.js'
import { writeFileSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

describe('ConfigWatcher', () => {
  let watcher: ConfigWatcher

  afterEach(() => watcher?.stop())

  it('calls onChange when file is modified', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcpinv-test-'))
    const file = join(dir, 'config.json')
    writeFileSync(file, '{}')

    const onChange = vi.fn()
    watcher = new ConfigWatcher()
    watcher.watch(file, onChange)

    await new Promise<void>(resolve => setTimeout(resolve, 50))
    writeFileSync(file, '{"updated": true}')
    await new Promise<void>(resolve => setTimeout(resolve, 200))

    expect(onChange).toHaveBeenCalled()
  })

  it('stop() prevents further callbacks', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcpinv-test-'))
    const file = join(dir, 'config.json')
    writeFileSync(file, '{}')

    const onChange = vi.fn()
    watcher = new ConfigWatcher()
    watcher.watch(file, onChange)
    watcher.stop()

    writeFileSync(file, '{"after-stop": true}')
    await new Promise<void>(resolve => setTimeout(resolve, 200))

    expect(onChange).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```
cd packages/bridge && npm test -- tests/config-watcher.test.ts
```

Expected: FAIL — `ConfigWatcher` not found.

- [ ] **Step 3: Implement config-watcher.ts**

```typescript
// packages/bridge/src/config-watcher.ts
import { watch, type FSWatcher } from 'fs'

export class ConfigWatcher {
  private watcher: FSWatcher | null = null

  watch(filePath: string, onChange: () => void): void {
    this.watcher = watch(filePath, { persistent: false }, () => onChange())
  }

  stop(): void {
    this.watcher?.close()
    this.watcher = null
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```
cd packages/bridge && npm test -- tests/config-watcher.test.ts
```

Expected: PASS — 2 tests.

- [ ] **Step 5: Build bridge package**

```
cd packages/bridge && npm run build
```

Expected: `dist/` directory created, no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add packages/bridge/src/config-watcher.ts packages/bridge/tests/config-watcher.test.ts packages/bridge/dist
git commit -m "feat: config watcher for hot-swap detection"
```

---

## Task 6: `mcpinv serve` Command

**Files:**
- Modify: `packages/cli/src/services/config-manager.ts` — add `getServerConfig()`
- Create: `packages/cli/src/commands/serve.ts`
- Modify: `packages/cli/src/index.ts` — register serve command

- [ ] **Step 1: Add getServerConfig to config-manager.ts**

Open `packages/cli/src/services/config-manager.ts` and add this function at the end:

```typescript
export async function getServerConfig(serverId: string): Promise<{ command: string; args: string[] } | null> {
  const configPath = getClaudeConfigPath()
  let raw: string
  try {
    raw = await fs.readFile(configPath, 'utf-8')
  } catch (err: any) {
    if (err?.code !== 'ENOENT') throw err
    return null
  }
  const config = JSON.parse(raw)
  const entry = config?.mcpServers?.[serverId]
  if (!entry) return null
  return { command: entry.command ?? 'npx', args: entry.args ?? [] }
}
```

- [ ] **Step 2: Write the failing test for serve command**

```typescript
// packages/cli/tests/commands/serve.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/services/config-manager.js', () => ({
  getServerConfig: vi.fn().mockResolvedValue({ command: 'node', args: ['server.js'] }),
  detectClients: vi.fn().mockReturnValue({ claude: '/path/to/claude.json', cursor: null, cline: null })
}))

vi.mock('../../src/services/keychain.js', () => ({
  listSecrets: vi.fn().mockResolvedValue([]),
  getSecret: vi.fn().mockResolvedValue(null)
}))

vi.mock('@mcpinv/bridge', () => ({
  McpClient: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    listTools: vi.fn().mockResolvedValue([{ name: 'ping', description: 'Ping', inputSchema: { type: 'object' } }]),
    close: vi.fn().mockResolvedValue(undefined)
  })),
  BridgeServer: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockResolvedValue(undefined),
    updateTools: vi.fn(),
    stop: vi.fn().mockResolvedValue(undefined)
  })),
  ConfigWatcher: vi.fn().mockImplementation(() => ({
    watch: vi.fn(),
    stop: vi.fn()
  }))
}))

import { serveCommand } from '../../src/commands/serve.js'

describe('serveCommand', () => {
  it('creates a Command named serve', () => {
    const cmd = serveCommand()
    expect(cmd.name()).toBe('serve')
  })

  it('requires a server-id argument', () => {
    const cmd = serveCommand()
    expect(cmd.registeredArguments[0].name()).toBe('server-id')
  })

  it('has --port option defaulting to 3000', () => {
    const cmd = serveCommand()
    const portOpt = cmd.options.find(o => o.long === '--port')
    expect(portOpt).toBeDefined()
    expect(portOpt?.defaultValue).toBe(3000)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

```
cd packages/cli && npm test -- tests/commands/serve.test.ts
```

Expected: FAIL — `serveCommand` not found.

- [ ] **Step 4: Implement serve.ts**

```typescript
// packages/cli/src/commands/serve.ts
import { Command } from 'commander'
import chalk from 'chalk'
import { homedir } from 'os'
import { join, mkdirSync } from 'path'
import { getServerConfig, detectClients } from '../services/config-manager.js'
import { listSecrets, getSecret } from '../services/keychain.js'
import { McpClient, BridgeServer, ConfigWatcher } from '@mcpinv/bridge'

export function serveCommand(): Command {
  return new Command('serve')
    .description('Start a local REST bridge for an installed MCP server')
    .argument('<server-id>', 'ID of the installed MCP server')
    .option('--port <number>', 'HTTP port', (v) => parseInt(v, 10), 3000)
    .option('--host <host>', 'Bind host', 'localhost')
    .option('--no-watch', 'Disable hot-swap on config changes')
    .option('--no-telemetry', 'Disable error DB and AI diagnosis')
    .action(async (serverId: string, opts: { port: number; host: string; watch: boolean }) => {
      const serverConfig = await getServerConfig(serverId)
      if (!serverConfig) {
        console.error(chalk.red(`Server "${serverId}" not found. Run: mcpinv install ${serverId}`))
        process.exit(1)
      }

      if (opts.host === '0.0.0.0') {
        console.warn(chalk.yellow('Warning: binding to 0.0.0.0 exposes the bridge on your network'))
      }

      const secretKeys = await listSecrets(serverId)
      const env: Record<string, string> = {}
      for (const key of secretKeys) {
        const value = await getSecret(serverId, key)
        if (value) env[key] = value
      }

      const logDir = join(homedir(), '.mcpinv', 'logs')
      mkdirSync(logDir, { recursive: true })
      const logPath = join(logDir, `bridge-${serverId}.log`)

      const client = new McpClient({ command: serverConfig.command, args: serverConfig.args, env })
      await client.connect()

      const server = new BridgeServer(client, { serverId, port: opts.port, host: opts.host, logPath })
      await server.start()

      const tools = await client.listTools()
      console.log(chalk.green(`✓ MCP server started (${serverId})`))
      console.log(chalk.green(`✓ ${tools.length} tools discovered`))
      console.log(chalk.green(`✓ Bridge running on http://${opts.host}:${opts.port}`))
      console.log(`  OpenAPI spec:  http://${opts.host}:${opts.port}/openapi.json`)
      console.log(`  Tool list:     http://${opts.host}:${opts.port}/tools`)

      if (opts.watch) {
        const clients = detectClients()
        const configPath = clients.claude ?? clients.cursor ?? clients.cline
        if (configPath) {
          const watcher = new ConfigWatcher()
          watcher.watch(configPath, async () => {
            const refreshed = await client.listTools()
            server.updateTools(refreshed)
          })
          console.log(chalk.dim('  Watching for config changes... (--no-watch to disable)'))
        }
      }

      const shutdown = async () => {
        await server.stop()
        await client.close()
        process.exit(0)
      }

      process.on('SIGINT', shutdown)
      process.on('SIGTERM', shutdown)
      setTimeout(() => {}, 2 ** 31 - 1)
    })
}
```

- [ ] **Step 5: Register serve command in index.ts**

Open `packages/cli/src/index.ts` and add:

```typescript
import { serveCommand } from './commands/serve.js'
```

And after the last `program.addCommand(...)`:

```typescript
program.addCommand(serveCommand())
```

- [ ] **Step 6: Run test to verify it passes**

```
cd packages/cli && npm test -- tests/commands/serve.test.ts
```

Expected: PASS — 3 tests.

- [ ] **Step 7: Build both packages**

```
cd packages/bridge && npm run build
cd ../cli && npm run build
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/cli/src/commands/serve.ts packages/cli/src/index.ts packages/cli/src/services/config-manager.ts packages/cli/tests/commands/serve.test.ts packages/bridge/dist
git commit -m "feat: mcpinv serve command — local MCP-to-REST bridge with hot-swap"
```

---

## Task 7: Diagnosis Data Layer (Collector + Analyzer + Error DB)

**Files:**
- Create: `packages/bridge/src/diagnose/collector.ts`
- Create: `packages/bridge/src/diagnose/analyzer.ts`
- Create: `packages/bridge/src/diagnose/error-db.ts`
- Create: `packages/bridge/tests/diagnose/collector.test.ts`
- Create: `packages/bridge/tests/diagnose/analyzer.test.ts`
- Create: `packages/bridge/tests/diagnose/error-db.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// packages/bridge/tests/diagnose/collector.test.ts
import { describe, it, expect } from 'vitest'
import { collectContext } from '../../src/diagnose/collector.js'
import { existsSync } from 'fs'
import { join, tmpdir } from 'path'
import { mkdtempSync, writeFileSync, mkdirSync } from 'fs'
import path from 'path'

describe('collectContext', () => {
  it('returns os and nodeVersion', async () => {
    const ctx = await collectContext('test-server', 1, 'some error', '/nonexistent')
    expect(['win32', 'darwin', 'linux']).toContain(ctx.os)
    expect(ctx.nodeVersion).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('detects missing node_modules', async () => {
    const ctx = await collectContext('test-server', 1, 'error', '/nonexistent/path')
    expect(ctx.hasNodeModules).toBe(false)
  })

  it('detects present node_modules', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcpinv-test-'))
    mkdirSync(join(dir, 'node_modules'))
    const ctx = await collectContext('test-server', 0, '', dir)
    expect(ctx.hasNodeModules).toBe(true)
  })
})
```

```typescript
// packages/bridge/tests/diagnose/analyzer.test.ts
import { describe, it, expect } from 'vitest'
import { analyzeLocally } from '../../src/diagnose/analyzer.js'
import type { DiagnosisContext } from '../../src/types.js'

const base: DiagnosisContext = { serverId: 'test', exitCode: 1, stderr: '', os: 'linux', nodeVersion: '20.0.0', hasNodeModules: true }

describe('analyzeLocally', () => {
  it('detects ENOENT as binary not found', () => {
    const result = analyzeLocally({ ...base, stderr: 'spawn ENOENT' })
    expect(result?.cause).toBe('binary_not_found')
    expect(result?.suggestion).toContain('mcpinv install')
  })

  it('detects missing module', () => {
    const result = analyzeLocally({ ...base, stderr: "Cannot find module '@octokit/rest'" })
    expect(result?.cause).toBe('missing_dependency')
    expect(result?.suggestion).toContain('npm install')
  })

  it('detects EADDRINUSE', () => {
    const result = analyzeLocally({ ...base, stderr: 'listen EADDRINUSE :::3000' })
    expect(result?.cause).toBe('port_in_use')
    expect(result?.suggestion).toContain('--port')
  })

  it('returns null for unknown error', () => {
    const result = analyzeLocally({ ...base, stderr: 'some completely unknown error xyzzy' })
    expect(result).toBeNull()
  })
})
```

```typescript
// packages/bridge/tests/diagnose/error-db.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn()
  }
}))

import axios from 'axios'
import { lookupError, reportError } from '../../src/diagnose/error-db.js'

describe('lookupError', () => {
  it('returns guide when found', async () => {
    const guide = { error_sig: 'abc', cause: 'missing_dependency', fixes: { windows: [], macos: [], linux: [] }, verified: false, contributed_by: 'community', server_type: 'node' }
    vi.mocked(axios.get).mockResolvedValueOnce({ data: { guide } })
    const result = await lookupError('abc123')
    expect(result?.cause).toBe('missing_dependency')
  })

  it('returns null on 404', async () => {
    vi.mocked(axios.get).mockRejectedValueOnce({ response: { status: 404 } })
    const result = await lookupError('unknown')
    expect(result).toBeNull()
  })

  it('returns null on network error', async () => {
    vi.mocked(axios.get).mockRejectedValueOnce(new Error('network'))
    const result = await lookupError('abc')
    expect(result).toBeNull()
  })
})

describe('reportError', () => {
  it('posts anonymized context', async () => {
    vi.mocked(axios.post).mockResolvedValueOnce({ data: { ok: true } })
    await reportError({ serverId: 'github', exitCode: 1, stderr: 'Cannot find module', os: 'linux', nodeVersion: '20.0.0', hasNodeModules: false })
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('errors.mcpinv.dev'),
      expect.objectContaining({ stderr: 'Cannot find module', os: 'linux' })
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```
cd packages/bridge && npm test -- tests/diagnose/
```

Expected: FAIL — modules not found.

- [ ] **Step 3: Implement collector.ts**

```typescript
// packages/bridge/src/diagnose/collector.ts
import { existsSync } from 'fs'
import { join } from 'path'
import { platform, version as nodeVersion } from 'process'
import type { DiagnosisContext } from '../types.js'

const OS_MAP: Record<string, string> = { win32: 'win32', darwin: 'darwin', linux: 'linux' }

export async function collectContext(
  serverId: string,
  exitCode: number | null,
  stderr: string,
  serverPath: string
): Promise<DiagnosisContext> {
  return {
    serverId,
    exitCode,
    stderr,
    os: OS_MAP[platform] ?? platform,
    nodeVersion: nodeVersion.replace(/^v/, ''),
    hasNodeModules: existsSync(join(serverPath, 'node_modules'))
  }
}
```

- [ ] **Step 4: Implement analyzer.ts**

```typescript
// packages/bridge/src/diagnose/analyzer.ts
import type { DiagnosisContext, ErrorPattern } from '../types.js'

const PATTERNS: Array<{ match: RegExp; cause: string; suggestion: string }> = [
  {
    match: /ENOENT/,
    cause: 'binary_not_found',
    suggestion: 'Check the server path or re-run: mcpinv install <server-id>'
  },
  {
    match: /Cannot find module/,
    cause: 'missing_dependency',
    suggestion: 'Run npm install in the server directory, or re-run: mcpinv install <server-id>'
  },
  {
    match: /EADDRINUSE/,
    cause: 'port_in_use',
    suggestion: 'Another process is using this port. Try: mcpinv serve <server-id> --port 3001'
  },
  {
    match: /auth|unauthorized|401|403/i,
    cause: 'missing_secret',
    suggestion: 'A required secret may be missing. Run: mcpinv migrate'
  }
]

export function analyzeLocally(ctx: DiagnosisContext): ErrorPattern | null {
  for (const pattern of PATTERNS) {
    if (pattern.match.test(ctx.stderr)) {
      return { cause: pattern.cause, suggestion: pattern.suggestion }
    }
  }
  return null
}
```

- [ ] **Step 5: Implement error-db.ts**

```typescript
// packages/bridge/src/diagnose/error-db.ts
import axios from 'axios'
import { createHash } from 'crypto'
import type { DiagnosisContext, ErrorGuide } from '../types.js'

const BASE = 'https://errors.mcpinv.dev'

function hashStderr(stderr: string): string {
  return createHash('sha256').update(stderr.slice(0, 512)).digest('hex').slice(0, 16)
}

export async function lookupError(sig: string): Promise<ErrorGuide | null> {
  try {
    const { data } = await axios.get(`${BASE}/lookup`, { params: { sig }, timeout: 5000 })
    return data.guide ?? null
  } catch {
    return null
  }
}

export async function reportError(ctx: DiagnosisContext): Promise<void> {
  try {
    await axios.post(`${BASE}/report`, {
      stderr: ctx.stderr.slice(0, 512),
      exit_code: ctx.exitCode,
      os: ctx.os,
      node_version: ctx.nodeVersion,
      has_node_modules: ctx.hasNodeModules,
      error_sig: hashStderr(ctx.stderr)
    }, { timeout: 5000 })
  } catch {}
}
```

- [ ] **Step 6: Run tests to verify they pass**

```
cd packages/bridge && npm test -- tests/diagnose/
```

Expected: PASS — 9 tests.

- [ ] **Step 7: Commit**

```bash
git add packages/bridge/src/diagnose/ packages/bridge/tests/diagnose/
git commit -m "feat: diagnosis data layer — collector, local analyzer, error DB client"
```

---

## Task 8: AI Assistant + `mcpinv diagnose` Command

**Files:**
- Create: `packages/bridge/src/diagnose/assistant.ts`
- Create: `packages/cli/src/commands/diagnose.ts`
- Modify: `packages/cli/src/index.ts` — register diagnose command

- [ ] **Step 1: Implement assistant.ts**

```typescript
// packages/bridge/src/diagnose/assistant.ts
import axios from 'axios'
import type { DiagnosisContext, ErrorGuide } from '../types.js'

const API_BASE = 'https://api.mcpinv.dev'

export interface AssistantResult {
  fix: string
  guide: Omit<ErrorGuide, 'error_sig' | 'contributed_by' | 'verified'> | null
}

export async function runAssistant(
  ctx: DiagnosisContext,
  onChunk: (text: string) => void
): Promise<AssistantResult> {
  const response = await axios.post(
    `${API_BASE}/diagnose`,
    {
      server_id: ctx.serverId,
      exit_code: ctx.exitCode,
      stderr: ctx.stderr.slice(0, 512),
      os: ctx.os,
      node_version: ctx.nodeVersion,
      has_node_modules: ctx.hasNodeModules
    },
    {
      responseType: 'stream',
      timeout: 30000
    }
  )

  let fullText = ''
  for await (const chunk of response.data) {
    const text = chunk.toString()
    fullText += text
    onChunk(text)
  }

  return { fix: fullText, guide: null }
}
```

- [ ] **Step 2: Write failing test for diagnose command**

```typescript
// packages/cli/tests/commands/diagnose.test.ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('@mcpinv/bridge', () => ({
  collectContext: vi.fn().mockResolvedValue({
    serverId: 'github', exitCode: 1, stderr: 'Cannot find module', os: 'linux', nodeVersion: '20.0.0', hasNodeModules: false
  }),
  analyzeLocally: vi.fn().mockReturnValue({ cause: 'missing_dependency', suggestion: 'Run npm install' }),
  lookupError: vi.fn().mockResolvedValue(null),
  reportError: vi.fn().mockResolvedValue(undefined),
  runAssistant: vi.fn().mockResolvedValue({ fix: 'Run npm install', guide: null })
}))

import { diagnoseCommand } from '../../src/commands/diagnose.js'

describe('diagnoseCommand', () => {
  it('creates a Command named diagnose', () => {
    const cmd = diagnoseCommand()
    expect(cmd.name()).toBe('diagnose')
  })

  it('requires a server-id argument', () => {
    const cmd = diagnoseCommand()
    expect(cmd.registeredArguments[0].name()).toBe('server-id')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

```
cd packages/cli && npm test -- tests/commands/diagnose.test.ts
```

Expected: FAIL — `diagnoseCommand` not found.

- [ ] **Step 4: Implement diagnose.ts**

```typescript
// packages/cli/src/commands/diagnose.ts
import { Command } from 'commander'
import chalk from 'chalk'
import inquirer from 'inquirer'
import { collectContext, analyzeLocally, lookupError, reportError, runAssistant } from '@mcpinv/bridge'
import { createHash } from 'crypto'

export function diagnoseCommand(): Command {
  return new Command('diagnose')
    .description('Diagnose a failing MCP server with AI-guided assistance')
    .argument('<server-id>', 'ID of the MCP server to diagnose')
    .option('--stderr <text>', 'Stderr output from the failed server (for scripted use)')
    .option('--exit-code <number>', 'Exit code from the failed server', parseInt)
    .option('--no-telemetry', 'Disable error DB lookup and AI assistance')
    .action(async (serverId: string, opts: { stderr?: string; exitCode?: number; telemetry: boolean }) => {
      const stderr = opts.stderr ?? ''
      const exitCode = opts.exitCode ?? null

      console.log(chalk.red(`\n✗ Diagnosing: ${serverId}`))
      if (stderr) console.log(chalk.dim(`  stderr: ${stderr.slice(0, 120)}`))

      const ctx = await collectContext(serverId, exitCode, stderr, process.cwd())

      // Tier 1: local pattern match
      const local = analyzeLocally(ctx)
      if (local) {
        console.log(chalk.yellow(`\n  Likely cause: ${local.cause}`))
        console.log(chalk.green(`  Fix: ${local.suggestion}\n`))
        return
      }

      if (!opts.telemetry) {
        console.log(chalk.dim('  No local match found. Telemetry disabled — run without --no-telemetry for community lookup.'))
        return
      }

      // Tier 2: error DB lookup
      const sig = createHash('sha256').update(stderr.slice(0, 512)).digest('hex').slice(0, 16)
      const guide = await lookupError(sig)
      if (guide) {
        const fixKey = ctx.os as keyof typeof guide.fixes
        const fixes = guide.fixes[fixKey] ?? guide.fixes.linux
        console.log(chalk.yellow(`\n  Community fix (${ctx.os}):`))
        fixes.forEach((step: string) => console.log(`  $ ${step}`))
        console.log()
        return
      }

      // Tier 3: AI assistant
      const { action } = await inquirer.prompt([{
        type: 'list',
        name: 'action',
        message: 'No match found. What would you like to do?',
        choices: [
          { name: 'Start interactive diagnosis (AI-guided)', value: 'ai' },
          { name: 'Share error + request fix suggestion', value: 'share' },
          { name: 'Cancel', value: 'cancel' }
        ]
      }])

      if (action === 'cancel') return

      if (action === 'share') {
        await reportError(ctx)
        console.log(chalk.green('\n  Error reported. Thank you — it helps the community!'))
        return
      }

      // AI guided dialog
      console.log(chalk.bold('\n────────────────────────────────────────'))
      console.log(chalk.bold('  mcpinv Diagnosis Assistant'))
      console.log(chalk.bold('────────────────────────────────────────\n'))

      let fix = ''
      try {
        const result = await runAssistant(ctx, (chunk) => process.stdout.write(chunk))
        fix = result.fix
      } catch {
        console.log(chalk.red('\n  Could not reach AI assistant. Check your connection.'))
        return
      }

      if (!fix) return

      const { share } = await inquirer.prompt([{
        type: 'confirm',
        name: 'share',
        message: '\nSave this fix as a community guide?',
        default: true
      }])

      if (share) {
        await reportError(ctx)
        console.log(chalk.green('  Shared anonymously. Thank you!'))
      }
    })
}
```

- [ ] **Step 5: Register diagnose command in index.ts**

Open `packages/cli/src/index.ts` and add:

```typescript
import { diagnoseCommand } from './commands/diagnose.js'
```

And:

```typescript
program.addCommand(diagnoseCommand())
```

- [ ] **Step 6: Run test to verify it passes**

```
cd packages/cli && npm test -- tests/commands/diagnose.test.ts
```

Expected: PASS — 2 tests.

- [ ] **Step 7: Build everything**

```
cd packages/bridge && npm run build
cd ../cli && npm run build
```

Expected: no errors.

- [ ] **Step 8: Run all tests**

From repo root:
```
npm --workspaces run test
```

Expected: all tests pass.

- [ ] **Step 9: Commit and push**

```bash
git add packages/bridge/src/diagnose/assistant.ts packages/cli/src/commands/diagnose.ts packages/cli/src/index.ts packages/cli/tests/commands/diagnose.test.ts packages/bridge/dist
git commit -m "feat: mcpinv diagnose — 3-tier AI-guided error diagnosis assistant"
git push
```
