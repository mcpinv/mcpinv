import { useEffect, useState } from 'react'
import {
  getServers, startServer, stopServer, subscribeEvents,
  type ServerStatus
} from '../../api/client.js'
import type { Panel } from '../../registry.js'

export function ServersPanel() {
  const [servers, setServers]   = useState<ServerStatus[]>([])
  const [error, setError]       = useState<string | null>(null)
  const [loading, setLoading]   = useState<Record<string, boolean>>({})
  const [actionError, setActionError] = useState<Record<string, string | null>>({})

  useEffect(() => {
    getServers().then(setServers).catch(e => setError((e as Error).message))
    return subscribeEvents(event => {
      const e = event as { type: string }
      if (['server_up', 'server_down', 'server_error'].includes(e.type)) {
        getServers().then(setServers).catch(() => {})
      }
    })
  }, [])

  const handleStart = async (id: string) => {
    setLoading(l => ({ ...l, [id]: true }))
    setActionError(e => ({ ...e, [id]: null }))
    try {
      await startServer(id)
      // Bridge will register itself via SSE → re-fetch triggered by subscribeEvents
    } catch (err) {
      const msg = (err as Error).message || 'Start failed'
      setActionError(e => ({ ...e, [id]: msg }))
      getServers().then(setServers).catch(() => {})
    } finally {
      setLoading(l => ({ ...l, [id]: false }))
    }
  }

  const handleStop = async (id: string) => {
    setLoading(l => ({ ...l, [id]: true }))
    setActionError(e => ({ ...e, [id]: null }))
    try {
      await stopServer(id)
    } catch (err) {
      const msg = (err as Error).message || 'Stop failed'
      setActionError(e => ({ ...e, [id]: msg }))
    } finally {
      setLoading(l => ({ ...l, [id]: false }))
      getServers().then(setServers).catch(() => {})
    }
  }

  if (error)           return <p style={{ color: '#ef4444' }}>Failed to load: {error}</p>
  if (!servers.length) return <p style={{ color: '#6b7280' }}>No servers registered. Run: mcpinv import</p>

  return (
    <div>
      <h1 style={{ fontSize: 18, fontWeight: 600, marginBottom: 20 }}>Servers</h1>
      <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ color: '#6b7280', textAlign: 'left', borderBottom: '1px solid #1f2937' }}>
            <th style={{ paddingBottom: 8, paddingRight: 16 }}>Server</th>
            <th style={{ paddingBottom: 8, paddingRight: 16 }}>Status</th>
            <th style={{ paddingBottom: 8, paddingRight: 16 }}>Uptime</th>
            <th style={{ paddingBottom: 8, paddingRight: 16 }}>Today</th>
            <th style={{ paddingBottom: 8, paddingRight: 16 }}>Last Error</th>
            <th style={{ paddingBottom: 8 }}>Actions</th>
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
              <td style={{ paddingRight: 16, color: '#9ca3af' }}>
                {s.uptime_ms != null ? formatUptime(s.uptime_ms) : '—'}
              </td>
              <td style={{ paddingRight: 16, color: '#9ca3af' }}>
                {s.today_calls}
              </td>
              <td style={{ color: '#ef4444', fontSize: 11, maxWidth: 200,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                paddingRight: 16 }}>
                {s.last_error ?? '—'}
              </td>
              <td>
                {s.status === 'running'
                  ? (
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      <button
                        aria-label={`Stop ${s.id}`}
                        disabled={loading[s.id]}
                        onClick={() => handleStop(s.id)}
                        style={{
                          padding: '3px 10px', borderRadius: 4, fontSize: 11,
                          cursor: loading[s.id] ? 'default' : 'pointer',
                          background: '#1f2937', color: '#fca5a5',
                          border: '1px solid #374151', opacity: loading[s.id] ? 0.5 : 1
                        }}
                      >
                        Stop
                      </button>
                      {actionError[s.id] && (
                        <span style={{ color: '#ef4444', fontSize: 10, marginLeft: 6 }}>
                          {actionError[s.id]}
                        </span>
                      )}
                    </div>
                  )
                  : (
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      <button
                        aria-label={`Start ${s.id}`}
                        disabled={loading[s.id]}
                        onClick={() => handleStart(s.id)}
                        style={{
                          padding: '3px 10px', borderRadius: 4, fontSize: 11,
                          cursor: loading[s.id] ? 'default' : 'pointer',
                          background: '#064e3b', color: '#34d399',
                          border: '1px solid #065f46', opacity: loading[s.id] ? 0.5 : 1
                        }}
                      >
                        Start
                      </button>
                      {actionError[s.id] && (
                        <span style={{ color: '#ef4444', fontSize: 10, marginLeft: 6 }}>
                          {actionError[s.id]}
                        </span>
                      )}
                    </div>
                  )
                }
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

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

export const panel: Panel = {
  id: 'servers',
  label: 'Servers',
  route: '/servers',
  component: ServersPanel,
  order: 1
}
