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
