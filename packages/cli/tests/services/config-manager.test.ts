import { describe, it, expect, vi, beforeEach } from 'vitest'
import { vol } from 'memfs'
import { detectClients, addServer, removeServer, listInstalled, hasPlaintextSecrets, windowsAppDataPath, wireServer } from '../../src/services/config-manager.js'

vi.mock('fs/promises', () => import('memfs').then(m => m.fs.promises))
vi.mock('os', () => ({ default: { homedir: () => '/home/test', platform: () => 'linux' } }))

describe('windowsAppDataPath', () => {
  it('returns APPDATA when set', () => {
    expect(windowsAppDataPath('C:\\Users\\Test\\AppData\\Roaming', 'C:\\Users\\Test'))
      .toBe('C:\\Users\\Test\\AppData\\Roaming')
  })

  it('falls back to homedir/AppData/Roaming when APPDATA is not set', () => {
    expect(windowsAppDataPath(undefined, 'C:\\Users\\Test'))
      .toBe('C:\\Users\\Test\\AppData\\Roaming')
  })
})

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

  it('wireServer rewrites server entry to use mcpinv serve --stdio', async () => {
    vol.fromJSON({
      '/home/test/.config/claude/claude_desktop_config.json': JSON.stringify({
        mcpServers: { 'mira-memory': { command: 'node', args: ['/path/to/server.js'] } }
      })
    })
    await wireServer('mira-memory')
    const raw = vol.readFileSync('/home/test/.config/claude/claude_desktop_config.json', 'utf8') as string
    const config = JSON.parse(raw)
    expect(config.mcpServers['mira-memory'].command).toBe('mcpinv')
    expect(config.mcpServers['mira-memory'].args).toEqual(['serve', 'mira-memory', '--stdio'])
  })

  it('wireServer preserves __mcpinv_original__ for unwire', async () => {
    vol.fromJSON({
      '/home/test/.config/claude/claude_desktop_config.json': JSON.stringify({
        mcpServers: { 'mira-memory': { command: 'node', args: ['/path/to/server.js'] } }
      })
    })
    await wireServer('mira-memory')
    const raw = vol.readFileSync('/home/test/.config/claude/claude_desktop_config.json', 'utf8') as string
    const config = JSON.parse(raw)
    expect(config.mcpServers['mira-memory'].__mcpinv_original__).toEqual({
      command: 'node',
      args: ['/path/to/server.js']
    })
  })

  it('wireServer is idempotent — wiring an already-wired server is a no-op', async () => {
    vol.fromJSON({
      '/home/test/.config/claude/claude_desktop_config.json': JSON.stringify({
        mcpServers: {
          'mira-memory': {
            __mcpinv_original__: { command: 'node', args: ['/path/to/server.js'] },
            command: 'mcpinv',
            args: ['serve', 'mira-memory', '--stdio']
          }
        }
      })
    })
    await wireServer('mira-memory')
    const raw = vol.readFileSync('/home/test/.config/claude/claude_desktop_config.json', 'utf8') as string
    const config = JSON.parse(raw)
    // Should not double-wrap: original must still point to 'node', not 'mcpinv'
    expect(config.mcpServers['mira-memory'].__mcpinv_original__.command).toBe('node')
    expect(config.mcpServers['mira-memory'].command).toBe('mcpinv')
  })

  it('wireServer does nothing when server is not in config', async () => {
    vol.fromJSON({
      '/home/test/.config/claude/claude_desktop_config.json': JSON.stringify({ mcpServers: {} })
    })
    await expect(wireServer('nonexistent')).resolves.toBeUndefined()
    const raw = vol.readFileSync('/home/test/.config/claude/claude_desktop_config.json', 'utf8') as string
    const config = JSON.parse(raw)
    expect(config.mcpServers['nonexistent']).toBeUndefined()
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
