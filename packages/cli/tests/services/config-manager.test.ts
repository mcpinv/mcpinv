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
