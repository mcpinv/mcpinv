import * as fs from 'fs/promises'
import os from 'os'
import path from 'path'

export interface ServerEntry {
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
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
    try { await fs.access(p); clients.push(p) } catch (err: any) { if (err?.code !== 'ENOENT') throw err }
  }
  return clients
}

export async function addServer(serverId: string, entry: ServerEntry): Promise<void> {
  const claudePath = claudeConfigPath()
  const config = await readJson(claudePath)
  config.mcpServers = config.mcpServers ?? {}
  config.mcpServers[serverId] = entry
  await writeJson(claudePath, config)

  const cursorPath = cursorConfigPath()
  try {
    await fs.access(cursorPath)
    const cursorConfig = await readJson(cursorPath)
    cursorConfig.mcpServers = cursorConfig.mcpServers ?? {}
    cursorConfig.mcpServers[serverId] = entry
    await writeJson(cursorPath, cursorConfig)
  } catch (err: any) {
    // Skip clients whose config directory doesn't exist yet
    if (err?.code !== 'ENOENT') throw err
  }
}

export async function removeServer(serverId: string): Promise<void> {
  const claudePath = claudeConfigPath()
  const config = await readJson(claudePath)
  delete config.mcpServers?.[serverId]
  await writeJson(claudePath, config)

  const cursorPath = cursorConfigPath()
  try {
    await fs.access(cursorPath)
    const cursorConfig = await readJson(cursorPath)
    delete cursorConfig.mcpServers?.[serverId]
    await writeJson(cursorPath, cursorConfig)
  } catch (err: any) {
    // Skip clients whose config directory doesn't exist yet
    if (err?.code !== 'ENOENT') throw err
  }
}

export async function listInstalled(): Promise<string[]> {
  const config = await readJson(claudeConfigPath())
  return Object.keys(config.mcpServers ?? {})
}

export async function getServerConfig(serverId: string): Promise<{ command: string; args: string[] } | null> {
  const config = await readJson(claudeConfigPath())
  const entry: ServerEntry | undefined = config?.mcpServers?.[serverId]
  if (!entry) return null
  return { command: entry.command ?? 'npx', args: entry.args ?? [] }
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
