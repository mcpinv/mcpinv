import { useEffect, useState } from 'react'
import { getServers, subscribeEvents, type ServerStatus } from '../../api/client.js'
import type { Panel } from '../../registry.js'

function formatUptime(ms: number): string {
  if (ms < 60_000)    return `${Math.floor(ms / 1_000)}s`
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`
  return `${Math.floor(ms / 3_600_000)}h`
}

function statusColor(status: string): string {
  if (status === 'running') return '#10b981'
  if (status === 'error')   return '#ef4444'
  return '#6b7280'
}

function ServersPanel() {
  const [servers, setServers] = useState<ServerStatus[]>([])
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    getServers().then(setServers).catch(e => setError((e as Error).message))
    return subscribeEvents(event => {
      const e = event as { type: string }
      if (['server_up', 'server_down', 'server_error'].includes(e.type)) {
        getServers().then(setServers).catch(() => {})
      }
    })
  }, [])

  if (error) return <p style={{ color: '#ef4444' }}>Failed to load: {error}</p>
  if (!servers.length) return <p style={{ color: '#6b7280' }}>No servers running.</p>

  return (
    <div>
      <h1 style={{ fontSize: 18, fontWeight: 600, marginBottom: 20 }}>Servers</h1>
      <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ color: '#6b7280', textAlign: 'left', borderBottom: '1px solid #1f2937' }}>
            <th style={{ paddingBottom: 8, paddingRight: 16 }}>Server</th>
            <th style={{ paddingBottom: 8, paddingRight: 16 }}>Status</th>
            <th style={{ paddingBottom: 8, paddingRight: 16 }}>Uptime</th>
            <th style={{ paddingBottom: 8 }}>Last Error</th>
          </tr>
        </thead>
        <tbody>
          {servers.map(s => (
            <tr key={s.id} style={{ borderBottom: '1px solid #111827' }}>
              <td style={{ padding: '10px 16px 10px 0', fontFamily: 'monospace' }}>{s.id}</td>
              <td style={{ paddingRight: 16 }}>
                <span style={{
                  padding: '2px 8px', borderRadius: 4, fontSize: 11,
                  background: `${statusColor(s.status)}22`, color: statusColor(s.status)
                }}>{s.status}</span>
              </td>
              <td style={{ paddingRight: 16, color: '#9ca3af' }}>{formatUptime(s.uptime_ms)}</td>
              <td style={{ color: '#ef4444', fontSize: 11, maxWidth: 300,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.last_error ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export const panel: Panel = {
  id: 'servers',
  label: 'Servers',
  route: '/servers',
  component: ServersPanel,
  order: 1
}
