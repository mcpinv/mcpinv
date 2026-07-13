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
