# mcpinv CLI — Implementation Plan (Weeks 1–2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and publish `inv` — a CLI that installs, runs, and manages MCP servers with zero JSON-editing and secure secrets storage in the OS Keychain.

**Architecture:** Commander.js CLI in TypeScript/ESM. Sources server metadata from Smithery API. Secrets stored via `keytar` in the OS Keychain (never in config files). Config injection writes `url`/`command` entries into Claude Desktop, Cursor, and Cline config files automatically.

**Tech Stack:** Node.js 20+, TypeScript 5, Commander.js, keytar, inquirer, chalk, ora, axios, vitest

---

## File Map

```
packages/cli/
  src/
    index.ts                  CLI entry point, registers all commands
    commands/
      search.ts               inv search <query>
      install.ts              inv install <server-id>
      remove.ts               inv remove <server-id>
      status.ts               inv status
      logs.ts                 inv logs <server-id>
      update.ts               inv update
      migrate.ts              inv migrate
    services/
      smithery.ts             Smithery API client (search + manifest fetch)
      keychain.ts             keytar wrapper (get/set/delete secrets)
      config-manager.ts       Read/write client configs (Claude, Cursor, Cline)
      process-manager.ts      Start/stop/status of local MCP server processes
    types/
      index.ts                McpServer, Secret, Deployment, ClientConfig types
  tests/
    services/
      smithery.test.ts
      keychain.test.ts
      config-manager.test.ts
      process-manager.test.ts
    commands/
      install.test.ts
      migrate.test.ts
  package.json
  tsconfig.json
  vitest.config.ts
```

---

## Task 1: Project Scaffold

**Files:**
- Create: `packages/cli/package.json`
- Create: `packages/cli/tsconfig.json`
- Create: `packages/cli/vitest.config.ts`
- Create: `packages/cli/src/index.ts`
- Create: `packages/cli/src/types/index.ts`

- [ ] **Step 1: Init project**

```bash
cd C:\Users\Anwender\IdeaProjects\mcpinv
mkdir -p packages/cli/src/commands packages/cli/src/services packages/cli/src/types packages/cli/tests/services packages/cli/tests/commands
```

- [ ] **Step 2: Write `packages/cli/package.json`**

```json
{
  "name": "mcpinv",
  "version": "0.1.0",
  "description": "Install, run and host MCP servers — invoke anything",
  "type": "module",
  "bin": {
    "inv": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "axios": "^1.7.2",
    "chalk": "^5.3.0",
    "commander": "^12.1.0",
    "inquirer": "^10.1.8",
    "keytar": "^7.9.0",
    "ora": "^8.0.1"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "typescript": "^5.5.0",
    "vitest": "^1.6.0"
  },
  "engines": {
    "node": ">=20.0.0"
  }
}
```

- [ ] **Step 3: Write `packages/cli/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 4: Write `packages/cli/vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    coverage: { reporter: ['text'] }
  }
})
```

- [ ] **Step 5: Write `packages/cli/src/types/index.ts`**

```typescript
export interface McpServer {
  id: string
  name: string
  description: string
  version: string
  runtime: 'node' | 'python' | 'binary'
  secrets: SecretSpec[]
  installCommand: string
  args: string[]
  source: 'smithery'
}

export interface SecretSpec {
  key: string
  description: string
  required: boolean
}

export interface InstalledServer {
  id: string
  name: string
  version: string
  installedAt: string
  remoteUrl?: string   // set when hosted on mcpinv
}

export interface ClientConfig {
  claude: string | null    // path to claude_desktop_config.json
  cursor: string | null    // path to .cursor/mcp.json
  cline: string | null     // path to VS Code settings
}
```

- [ ] **Step 6: Write `packages/cli/src/index.ts`**

```typescript
#!/usr/bin/env node
import { program } from 'commander'
import { searchCommand } from './commands/search.js'
import { installCommand } from './commands/install.js'
import { removeCommand } from './commands/remove.js'
import { statusCommand } from './commands/status.js'
import { logsCommand } from './commands/logs.js'
import { updateCommand } from './commands/update.js'
import { migrateCommand } from './commands/migrate.js'

program
  .name('inv')
  .description('Install, run and host MCP servers')
  .version('0.1.0')

program.addCommand(searchCommand())
program.addCommand(installCommand())
program.addCommand(removeCommand())
program.addCommand(statusCommand())
program.addCommand(logsCommand())
program.addCommand(updateCommand())
program.addCommand(migrateCommand())

program.parse()
```

- [ ] **Step 7: Install dependencies**

```bash
cd packages/cli && npm install
```

- [ ] **Step 8: Commit**

```bash
git init C:\Users\Anwender\IdeaProjects\mcpinv
cd C:\Users\Anwender\IdeaProjects\mcpinv
git add packages/cli/package.json packages/cli/tsconfig.json packages/cli/vitest.config.ts packages/cli/src/
git commit -m "feat: scaffold mcpinv CLI project"
```

---

## Task 2: Smithery API Service

**Files:**
- Create: `packages/cli/src/services/smithery.ts`
- Create: `packages/cli/tests/services/smithery.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/cli/tests/services/smithery.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import axios from 'axios'
import { searchServers, fetchManifest } from '../../src/services/smithery.js'

vi.mock('axios')
const mockedAxios = vi.mocked(axios)

describe('smithery service', () => {
  beforeEach(() => vi.clearAllMocks())

  it('searchServers returns list for query', async () => {
    mockedAxios.get = vi.fn().mockResolvedValue({
      data: {
        items: [
          { qualifiedName: 'github-mcp-server', displayName: 'GitHub', description: 'GitHub tools', version: '1.0.0' }
        ]
      }
    })
    const results = await searchServers('github')
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('github-mcp-server')
  })

  it('fetchManifest returns server details', async () => {
    mockedAxios.get = vi.fn().mockResolvedValue({
      data: {
        qualifiedName: 'github-mcp-server',
        displayName: 'GitHub',
        description: 'GitHub MCP tools',
        version: '1.2.0',
        runtime: 'node',
        connections: [{ type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] }],
        environmentVariables: [{ name: 'GITHUB_TOKEN', description: 'GitHub personal access token', required: true }]
      }
    })
    const manifest = await fetchManifest('github-mcp-server')
    expect(manifest.id).toBe('github-mcp-server')
    expect(manifest.secrets).toHaveLength(1)
    expect(manifest.secrets[0].key).toBe('GITHUB_TOKEN')
  })

  it('searchServers returns empty array when no results', async () => {
    mockedAxios.get = vi.fn().mockResolvedValue({ data: { items: [] } })
    const results = await searchServers('nonexistent-xyz-123')
    expect(results).toEqual([])
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd packages/cli && npm test -- tests/services/smithery.test.ts
```
Expected: FAIL — `Cannot find module '../../src/services/smithery.js'`

- [ ] **Step 3: Write `packages/cli/src/services/smithery.ts`**

```typescript
import axios from 'axios'
import type { McpServer } from '../types/index.js'

const BASE = 'https://registry.smithery.ai'

export async function searchServers(query: string): Promise<McpServer[]> {
  const { data } = await axios.get(`${BASE}/servers`, {
    params: { q: query, pageSize: 20 }
  })
  return (data.items ?? []).map(mapToServer)
}

export async function fetchManifest(id: string): Promise<McpServer> {
  const { data } = await axios.get(`${BASE}/servers/${id}`)
  return mapToServer(data)
}

function mapToServer(raw: any): McpServer {
  const conn = raw.connections?.[0] ?? {}
  return {
    id: raw.qualifiedName,
    name: raw.displayName ?? raw.qualifiedName,
    description: raw.description ?? '',
    version: raw.version ?? 'latest',
    runtime: 'node',
    secrets: (raw.environmentVariables ?? []).map((e: any) => ({
      key: e.name,
      description: e.description ?? '',
      required: e.required ?? false
    })),
    installCommand: conn.command ?? 'npx',
    args: conn.args ?? [],
    source: 'smithery'
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd packages/cli && npm test -- tests/services/smithery.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/services/smithery.ts packages/cli/tests/services/smithery.test.ts
git commit -m "feat: smithery API client with search and manifest fetch"
```

---

## Task 3: Keychain Service

**Files:**
- Create: `packages/cli/src/services/keychain.ts`
- Create: `packages/cli/tests/services/keychain.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/cli/tests/services/keychain.test.ts
import { describe, it, expect, vi } from 'vitest'
import { setSecret, getSecret, deleteSecret, listSecrets } from '../../src/services/keychain.js'

vi.mock('keytar', () => ({
  default: {
    setPassword: vi.fn().mockResolvedValue(undefined),
    getPassword: vi.fn().mockResolvedValue('my-token'),
    deletePassword: vi.fn().mockResolvedValue(true),
    findCredentials: vi.fn().mockResolvedValue([
      { account: 'github-mcp-server:GITHUB_TOKEN', password: 'tok' }
    ])
  }
}))

describe('keychain service', () => {
  it('setSecret stores with service prefix', async () => {
    const keytar = (await import('keytar')).default
    await setSecret('github-mcp-server', 'GITHUB_TOKEN', 'ghp_abc')
    expect(keytar.setPassword).toHaveBeenCalledWith(
      'mcpinv', 'github-mcp-server:GITHUB_TOKEN', 'ghp_abc'
    )
  })

  it('getSecret retrieves stored secret', async () => {
    const value = await getSecret('github-mcp-server', 'GITHUB_TOKEN')
    expect(value).toBe('my-token')
  })

  it('deleteSecret removes entry', async () => {
    await deleteSecret('github-mcp-server', 'GITHUB_TOKEN')
    const keytar = (await import('keytar')).default
    expect(keytar.deletePassword).toHaveBeenCalledWith('mcpinv', 'github-mcp-server:GITHUB_TOKEN')
  })

  it('listSecrets returns keys for server', async () => {
    const keys = await listSecrets('github-mcp-server')
    expect(keys).toContain('GITHUB_TOKEN')
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd packages/cli && npm test -- tests/services/keychain.test.ts
```

- [ ] **Step 3: Write `packages/cli/src/services/keychain.ts`**

```typescript
import keytar from 'keytar'

const SERVICE = 'mcpinv'

function accountKey(serverId: string, secretKey: string): string {
  return `${serverId}:${secretKey}`
}

export async function setSecret(serverId: string, key: string, value: string): Promise<void> {
  await keytar.setPassword(SERVICE, accountKey(serverId, key), value)
}

export async function getSecret(serverId: string, key: string): Promise<string | null> {
  return keytar.getPassword(SERVICE, accountKey(serverId, key))
}

export async function deleteSecret(serverId: string, key: string): Promise<void> {
  await keytar.deletePassword(SERVICE, accountKey(serverId, key))
}

export async function listSecrets(serverId: string): Promise<string[]> {
  const creds = await keytar.findCredentials(SERVICE)
  return creds
    .filter(c => c.account.startsWith(`${serverId}:`))
    .map(c => c.account.split(':')[1])
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd packages/cli && npm test -- tests/services/keychain.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/services/keychain.ts packages/cli/tests/services/keychain.test.ts
git commit -m "feat: keychain service — secrets stored in OS keychain, never in config files"
```

---

## Task 4: Config Manager (Client Config Injection)

**Files:**
- Create: `packages/cli/src/services/config-manager.ts`
- Create: `packages/cli/tests/services/config-manager.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/cli/tests/services/config-manager.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { vol } from 'memfs'
import { detectClients, addServer, removeServer, listInstalled, hasPlaintextSecrets } from '../../src/services/config-manager.js'

vi.mock('fs/promises', () => import('memfs').then(m => m.fs.promises))
vi.mock('os', () => ({ default: { homedir: () => '/home/test', platform: () => 'linux' } }))

describe('config-manager', () => {
  beforeEach(() => vol.reset())

  it('addServer writes entry into Claude config', async () => {
    vol.fromJSON({
      '/home/test/.config/claude/claude_desktop_config.json': JSON.stringify({ mcpServers: {} })
    })
    await addServer('github-mcp-server', {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_TOKEN: 'keychain://mcpinv/github-mcp-server:GITHUB_TOKEN' }
    })
    const raw = vol.readFileSync('/home/test/.config/claude/claude_desktop_config.json', 'utf8') as string
    const config = JSON.parse(raw)
    expect(config.mcpServers['github-mcp-server']).toBeDefined()
    expect(config.mcpServers['github-mcp-server'].command).toBe('npx')
  })

  it('removeServer deletes entry from Claude config', async () => {
    vol.fromJSON({
      '/home/test/.config/claude/claude_desktop_config.json': JSON.stringify({
        mcpServers: { 'github-mcp-server': { command: 'npx', args: [] } }
      })
    })
    await removeServer('github-mcp-server')
    const raw = vol.readFileSync('/home/test/.config/claude/claude_desktop_config.json', 'utf8') as string
    const config = JSON.parse(raw)
    expect(config.mcpServers['github-mcp-server']).toBeUndefined()
  })

  it('hasPlaintextSecrets detects tokens in config', async () => {
    vol.fromJSON({
      '/home/test/.config/claude/claude_desktop_config.json': JSON.stringify({
        mcpServers: {
          github: { command: 'npx', args: [], env: { GITHUB_TOKEN: 'ghp_realtoken123' } }
        }
      })
    })
    const found = await hasPlaintextSecrets()
    expect(found).toHaveLength(1)
    expect(found[0].key).toBe('GITHUB_TOKEN')
    expect(found[0].serverId).toBe('github')
  })
})
```

- [ ] **Step 2: Install memfs for tests**

```bash
cd packages/cli && npm install -D memfs
```

- [ ] **Step 3: Run test — expect FAIL**

```bash
cd packages/cli && npm test -- tests/services/config-manager.test.ts
```

- [ ] **Step 4: Write `packages/cli/src/services/config-manager.ts`**

```typescript
import fs from 'fs/promises'
import os from 'os'
import path from 'path'

export interface ServerEntry {
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string   // for remote/hosted servers
}

export interface PlaintextSecret {
  serverId: string
  key: string
  value: string
}

function claudeConfigPath(): string {
  const home = os.homedir()
  const platform = os.platform()
  if (platform === 'win32') {
    return path.join(process.env.APPDATA ?? home, 'Claude', 'claude_desktop_config.json')
  }
  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
  }
  return path.join(home, '.config', 'claude', 'claude_desktop_config.json')
}

function cursorConfigPath(): string {
  return path.join(os.homedir(), '.cursor', 'mcp.json')
}

async function readJson(filePath: string): Promise<any> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return { mcpServers: {} }
  }
}

async function writeJson(filePath: string, data: any): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8')
}

export async function detectClients(): Promise<string[]> {
  const clients: string[] = []
  for (const p of [claudeConfigPath(), cursorConfigPath()]) {
    try { await fs.access(p); clients.push(p) } catch {}
  }
  return clients
}

export async function addServer(serverId: string, entry: ServerEntry): Promise<void> {
  for (const configPath of [claudeConfigPath(), cursorConfigPath()]) {
    try {
      await fs.access(path.dirname(configPath))
      const config = await readJson(configPath)
      config.mcpServers = config.mcpServers ?? {}
      config.mcpServers[serverId] = entry
      await writeJson(configPath, config)
    } catch {}
  }
}

export async function removeServer(serverId: string): Promise<void> {
  for (const configPath of [claudeConfigPath(), cursorConfigPath()]) {
    try {
      const config = await readJson(configPath)
      delete config.mcpServers?.[serverId]
      await writeJson(configPath, config)
    } catch {}
  }
}

export async function listInstalled(): Promise<string[]> {
  const config = await readJson(claudeConfigPath())
  return Object.keys(config.mcpServers ?? {})
}

export async function hasPlaintextSecrets(): Promise<PlaintextSecret[]> {
  const config = await readJson(claudeConfigPath())
  const found: PlaintextSecret[] = []
  for (const [serverId, entry] of Object.entries<any>(config.mcpServers ?? {})) {
    for (const [key, value] of Object.entries<any>(entry.env ?? {})) {
      if (typeof value === 'string' && !value.startsWith('keychain://')) {
        found.push({ serverId, key, value })
      }
    }
  }
  return found
}
```

- [ ] **Step 5: Run test — expect PASS**

```bash
cd packages/cli && npm test -- tests/services/config-manager.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/services/config-manager.ts packages/cli/tests/services/config-manager.test.ts
git commit -m "feat: config-manager injects/removes server entries in Claude+Cursor configs"
```

---

## Task 5: `inv search` Command

**Files:**
- Create: `packages/cli/src/commands/search.ts`

- [ ] **Step 1: Write `packages/cli/src/commands/search.ts`**

```typescript
import { Command } from 'commander'
import chalk from 'chalk'
import ora from 'ora'
import { searchServers } from '../services/smithery.js'

export function searchCommand(): Command {
  return new Command('search')
    .description('Search for MCP servers')
    .argument('<query>', 'Search term')
    .action(async (query: string) => {
      const spinner = ora(`Searching for "${query}"...`).start()
      try {
        const results = await searchServers(query)
        spinner.stop()
        if (results.length === 0) {
          console.log(chalk.yellow('No servers found.'))
          return
        }
        console.log(chalk.bold(`\n${results.length} server(s) found:\n`))
        for (const s of results) {
          console.log(`  ${chalk.cyan(s.id)}`)
          console.log(`  ${chalk.dim(s.description)}`)
          console.log(`  ${chalk.green(`inv install ${s.id}`)}\n`)
        }
      } catch (err) {
        spinner.fail('Search failed')
        console.error(chalk.red(String(err)))
        process.exit(1)
      }
    })
}
```

- [ ] **Step 2: Build and smoke-test**

```bash
cd packages/cli && npm run build && node dist/index.js search github
```
Expected: list of GitHub-related MCP servers

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/commands/search.ts
git commit -m "feat: inv search command"
```

---

## Task 6: `inv install` Command

**Files:**
- Create: `packages/cli/src/commands/install.ts`
- Create: `packages/cli/tests/commands/install.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// packages/cli/tests/commands/install.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/services/smithery.js', () => ({
  fetchManifest: vi.fn().mockResolvedValue({
    id: 'github-mcp-server',
    name: 'GitHub',
    description: 'GitHub tools',
    version: '1.0.0',
    runtime: 'node',
    secrets: [{ key: 'GITHUB_TOKEN', description: 'GitHub token', required: true }],
    installCommand: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    source: 'smithery'
  })
}))
vi.mock('../../src/services/keychain.js', () => ({
  setSecret: vi.fn().mockResolvedValue(undefined),
  getSecret: vi.fn().mockResolvedValue(null)
}))
vi.mock('../../src/services/config-manager.js', () => ({
  addServer: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('inquirer', () => ({
  default: { prompt: vi.fn().mockResolvedValue({ GITHUB_TOKEN: 'ghp_test' }) }
}))

describe('install command logic', () => {
  it('fetches manifest, stores secret, injects config', async () => {
    const { fetchManifest } = await import('../../src/services/smithery.js')
    const { setSecret } = await import('../../src/services/keychain.js')
    const { addServer } = await import('../../src/services/config-manager.js')
    const inquirer = (await import('inquirer')).default

    const manifest = await fetchManifest('github-mcp-server')
    const answers = await inquirer.prompt([{ name: 'GITHUB_TOKEN', type: 'password', message: 'GitHub token:' }])
    await setSecret(manifest.id, 'GITHUB_TOKEN', answers.GITHUB_TOKEN)
    await addServer(manifest.id, {
      command: manifest.installCommand,
      args: manifest.args,
      env: { GITHUB_TOKEN: `keychain://mcpinv/${manifest.id}:GITHUB_TOKEN` }
    })

    expect(fetchManifest).toHaveBeenCalledWith('github-mcp-server')
    expect(setSecret).toHaveBeenCalledWith('github-mcp-server', 'GITHUB_TOKEN', 'ghp_test')
    expect(addServer).toHaveBeenCalledWith('github-mcp-server', expect.objectContaining({
      command: 'npx',
      env: { GITHUB_TOKEN: 'keychain://mcpinv/github-mcp-server:GITHUB_TOKEN' }
    }))
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd packages/cli && npm test -- tests/commands/install.test.ts
```

- [ ] **Step 3: Write `packages/cli/src/commands/install.ts`**

```typescript
import { Command } from 'commander'
import chalk from 'chalk'
import ora from 'ora'
import inquirer from 'inquirer'
import { fetchManifest } from '../services/smithery.js'
import { setSecret, getSecret } from '../services/keychain.js'
import { addServer } from '../services/config-manager.js'

export function installCommand(): Command {
  return new Command('install')
    .description('Install an MCP server')
    .argument('<server-id>', 'Server ID from inv search')
    .action(async (serverId: string) => {
      const spinner = ora(`Fetching manifest for ${serverId}...`).start()
      let manifest
      try {
        manifest = await fetchManifest(serverId)
        spinner.succeed(`Found: ${manifest.name} v${manifest.version}`)
      } catch {
        spinner.fail(`Server "${serverId}" not found`)
        process.exit(1)
      }

      // Prompt for required secrets not already in keychain
      const env: Record<string, string> = {}
      for (const secret of manifest.secrets) {
        const existing = await getSecret(serverId, secret.key)
        if (existing) {
          console.log(chalk.dim(`  ${secret.key}: using stored value`))
          env[secret.key] = `keychain://mcpinv/${serverId}:${secret.key}`
          continue
        }
        if (!secret.required) continue
        const answer = await inquirer.prompt([{
          name: secret.key,
          type: 'password',
          message: `${secret.description || secret.key}:`,
          mask: '*'
        }])
        await setSecret(serverId, secret.key, answer[secret.key])
        env[secret.key] = `keychain://mcpinv/${serverId}:${secret.key}`
      }

      const injectSpinner = ora('Updating client configs...').start()
      await addServer(serverId, {
        command: manifest.installCommand,
        args: manifest.args,
        env
      })
      injectSpinner.succeed('Done!')

      console.log(chalk.green(`\n✓ ${manifest.name} installed`))
      console.log(chalk.dim('  Restart Claude Desktop / Cursor to activate\n'))
    })
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd packages/cli && npm test -- tests/commands/install.test.ts
```

- [ ] **Step 5: Smoke-test**

```bash
cd packages/cli && npm run build && node dist/index.js install github-mcp-server
```

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/commands/install.ts packages/cli/tests/commands/install.test.ts
git commit -m "feat: inv install — prompts for secrets, stores in keychain, injects config"
```

---

## Task 7: `inv remove`, `inv status`, `inv logs`

**Files:**
- Create: `packages/cli/src/commands/remove.ts`
- Create: `packages/cli/src/commands/status.ts`
- Create: `packages/cli/src/commands/logs.ts`

- [ ] **Step 1: Write `packages/cli/src/commands/remove.ts`**

```typescript
import { Command } from 'commander'
import chalk from 'chalk'
import inquirer from 'inquirer'
import { removeServer, listInstalled } from '../services/config-manager.js'
import { listSecrets, deleteSecret } from '../services/keychain.js'

export function removeCommand(): Command {
  return new Command('remove')
    .description('Uninstall an MCP server')
    .argument('<server-id>', 'Server to remove')
    .action(async (serverId: string) => {
      const { confirm } = await inquirer.prompt([{
        name: 'confirm', type: 'confirm',
        message: `Remove ${serverId} and its stored secrets?`,
        default: false
      }])
      if (!confirm) return

      await removeServer(serverId)
      const secrets = await listSecrets(serverId)
      for (const key of secrets) await deleteSecret(serverId, key)

      console.log(chalk.green(`✓ ${serverId} removed`))
      console.log(chalk.dim('  Restart Claude Desktop / Cursor to deactivate\n'))
    })
}
```

- [ ] **Step 2: Write `packages/cli/src/commands/status.ts`**

```typescript
import { Command } from 'commander'
import chalk from 'chalk'
import { listInstalled } from '../services/config-manager.js'

export function statusCommand(): Command {
  return new Command('status')
    .description('Show installed MCP servers')
    .action(async () => {
      const servers = await listInstalled()
      if (servers.length === 0) {
        console.log(chalk.yellow('No servers installed. Run: inv search <query>'))
        return
      }
      console.log(chalk.bold(`\nInstalled servers (${servers.length}):\n`))
      for (const id of servers) {
        console.log(`  ${chalk.cyan('●')} ${id}`)
      }
      console.log()
    })
}
```

- [ ] **Step 3: Write `packages/cli/src/commands/logs.ts`**

```typescript
import { Command } from 'commander'
import chalk from 'chalk'
import { spawnSync } from 'child_process'
import os from 'os'
import path from 'path'
import fs from 'fs'

export function logsCommand(): Command {
  return new Command('logs')
    .description('Show logs for an installed MCP server')
    .argument('<server-id>', 'Server ID')
    .option('-n, --lines <number>', 'Number of lines', '50')
    .action(async (serverId: string, opts: { lines: string }) => {
      const logFile = path.join(os.homedir(), '.mcpinv', 'logs', `${serverId}.log`)
      if (!fs.existsSync(logFile)) {
        console.log(chalk.yellow(`No logs found for ${serverId}`))
        console.log(chalk.dim(`Log file expected at: ${logFile}`))
        return
      }
      const lines = parseInt(opts.lines, 10)
      const content = fs.readFileSync(logFile, 'utf-8').split('\n').slice(-lines).join('\n')
      console.log(chalk.dim(`--- last ${lines} lines: ${logFile} ---\n`))
      console.log(content)
    })
}
```

- [ ] **Step 4: Build and verify all commands registered**

```bash
cd packages/cli && npm run build && node dist/index.js --help
```
Expected: shows search, install, remove, status, logs, update, migrate

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/remove.ts packages/cli/src/commands/status.ts packages/cli/src/commands/logs.ts
git commit -m "feat: inv remove, status, logs commands"
```

---

## Task 8: `inv migrate` Command

**Files:**
- Create: `packages/cli/src/commands/migrate.ts`

- [ ] **Step 1: Write `packages/cli/src/commands/migrate.ts`**

```typescript
import { Command } from 'commander'
import chalk from 'chalk'
import inquirer from 'inquirer'
import { hasPlaintextSecrets, addServer } from '../services/config-manager.js'
import { setSecret } from '../services/keychain.js'

export function migrateCommand(): Command {
  return new Command('migrate')
    .description('Move plaintext secrets from config files into the OS Keychain')
    .action(async () => {
      const found = await hasPlaintextSecrets()
      if (found.length === 0) {
        console.log(chalk.green('✓ No plaintext secrets found — you are already secure!'))
        return
      }

      console.log(chalk.yellow(`\nFound ${found.length} plaintext secret(s) in your config:\n`))
      for (const s of found) {
        console.log(`  ${chalk.cyan(s.serverId)} → ${s.key}: ${chalk.red(s.value.slice(0, 8) + '...')}`)
      }

      const { confirm } = await inquirer.prompt([{
        name: 'confirm', type: 'confirm',
        message: 'Move all to OS Keychain and remove from config?',
        default: true
      }])
      if (!confirm) return

      for (const s of found) {
        await setSecret(s.serverId, s.key, s.value)
        console.log(chalk.green(`  ✓ ${s.serverId}:${s.key} → Keychain`))
      }

      console.log(chalk.green('\n✓ Migration complete. Restart your AI clients to apply.\n'))
    })
}
```

- [ ] **Step 2: Write `packages/cli/src/commands/update.ts`**

```typescript
import { Command } from 'commander'
import chalk from 'chalk'
import ora from 'ora'
import { listInstalled } from '../services/config-manager.js'
import { fetchManifest } from '../services/smithery.js'

export function updateCommand(): Command {
  return new Command('update')
    .description('Check for updates to installed MCP servers')
    .action(async () => {
      const servers = await listInstalled()
      if (servers.length === 0) {
        console.log(chalk.yellow('No servers installed.'))
        return
      }
      console.log(chalk.bold('\nChecking for updates...\n'))
      for (const id of servers) {
        const spinner = ora(id).start()
        try {
          const manifest = await fetchManifest(id)
          spinner.succeed(`${id} — latest: v${manifest.version}`)
        } catch {
          spinner.warn(`${id} — could not fetch latest version`)
        }
      }
      console.log()
    })
}
```

- [ ] **Step 3: Build and test migrate**

```bash
cd packages/cli && npm run build && node dist/index.js migrate
```

- [ ] **Step 4: Run all tests**

```bash
cd packages/cli && npm test
```
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/migrate.ts packages/cli/src/commands/update.ts
git commit -m "feat: inv migrate (plaintext secrets → keychain) and inv update"
```

---

## Task 9: README + npm Publish

**Files:**
- Create: `packages/cli/README.md`

- [ ] **Step 1: Write `packages/cli/README.md`**

```markdown
# mcpinv — invoke anything

Install, run and host MCP servers in seconds.

## Install

```bash
npm install -g mcpinv
```

## Usage

```bash
inv search github          # find servers
inv install github-mcp-server  # install + inject into Claude/Cursor
inv status                 # what's installed
inv logs github-mcp-server # tail logs
inv remove github-mcp-server   # uninstall
inv migrate                # move existing plaintext tokens to Keychain
```

## How it works

- Installs MCP servers from [Smithery](https://smithery.ai)
- Secrets stored in your OS Keychain — never in config files
- Auto-injects into Claude Desktop, Cursor, and Cline
```

- [ ] **Step 2: Final build + test**

```bash
cd packages/cli && npm run build && npm test
```

- [ ] **Step 3: Dry-run publish**

```bash
cd packages/cli && npm publish --dry-run
```
Expected: lists files, no errors

- [ ] **Step 4: Publish**

```bash
cd packages/cli && npm publish --access public
```

- [ ] **Step 5: Final commit**

```bash
git add packages/cli/README.md
git commit -m "feat: publish mcpinv 0.1.0 to npm"
git tag v0.1.0
```

---

## Nächster Plan: Weeks 3–4 — Hosted Runtime

Nach Abschluss dieses Plans folgt: `2026-06-27-mcpinv-backend-mvp.md`

Inhalte: Quarkus Backend, Docker-in-Docker, Hetzner EU, Stripe, MCP-to-REST Bridge Sidecar, `inv deploy` Command.
