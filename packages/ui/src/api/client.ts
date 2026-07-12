const BASE = ''

export interface ServerStatus {
  id: string
  status: 'running' | 'stopped' | 'error'
  uptime_ms: number | null
  restart_count: number
  last_error: string | null
  today_calls: number
}

export interface ToolCall {
  id: number
  ts: number
  server_id: string
  tool_name: string
  duration_ms: number | null
  input_tokens: number | null
  output_tokens: number | null
  success: number
  error_msg: string | null
}

export interface TokenSummary {
  total_calls: number
  total_input_tokens: number | null
  total_output_tokens: number | null
  top_tool: { name: string; calls: number } | null
}

export interface DailyBucket {
  date: string
  calls: number
  input_tokens: number | null
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`)
  if (!r.ok) throw new Error(`${path}: ${r.status}`)
  return r.json() as Promise<T>
}

export const getServers      = () => get<ServerStatus[]>('/api/servers')

export async function startServer(id: string): Promise<void> {
  const r = await fetch(`${BASE}/api/servers/${encodeURIComponent(id)}/start`, { method: 'POST' })
  if (!r.ok) throw new Error(`start ${id}: ${r.status}`)
}

export async function stopServer(id: string): Promise<void> {
  const r = await fetch(`${BASE}/api/servers/${encodeURIComponent(id)}/stop`, { method: 'POST' })
  if (!r.ok) throw new Error(`stop ${id}: ${r.status}`)
}
export const getTokenSummary = () => get<TokenSummary>('/api/tokens/summary')
export const getTokensDaily  = (days = 14) => get<DailyBucket[]>(`/api/tokens/daily?days=${days}`)

export function getCalls(params?: { limit?: number; server?: string; status?: string }) {
  const q = new URLSearchParams()
  if (params?.limit)  q.set('limit',  String(params.limit))
  if (params?.server) q.set('server', params.server)
  if (params?.status) q.set('status', params.status)
  return get<ToolCall[]>(`/api/calls?${q}`)
}

export function subscribeEvents(onEvent: (e: unknown) => void): () => void {
  const es = new EventSource(`${BASE}/api/events`)
  es.onmessage = e => onEvent(JSON.parse(e.data as string))
  return () => es.close()
}
