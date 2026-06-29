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
