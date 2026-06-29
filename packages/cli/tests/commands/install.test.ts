import { describe, it, expect, vi } from 'vitest'

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
