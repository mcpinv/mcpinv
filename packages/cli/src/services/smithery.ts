import axios from 'axios'
import type { McpServer } from '../types/index.js'

const BASE = 'https://registry.smithery.ai'

export async function searchServers(query: string): Promise<McpServer[]> {
  const { data } = await axios.get(`${BASE}/servers`, {
    params: { q: query, pageSize: 20 }
  })
  return (data.servers ?? data.items ?? []).map(mapToServer)
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
