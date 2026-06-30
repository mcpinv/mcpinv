import { describe, it, expect, vi } from 'vitest'

vi.mock('../../src/services/config-manager.js', () => ({
  getServerConfig: vi.fn().mockResolvedValue({ command: 'node', args: ['server.js'] }),
  detectClients: vi.fn().mockResolvedValue(['/path/to/claude.json'])
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
