import { useEffect, useRef, useState } from 'react'
import { getCalls, subscribeEvents, type ToolCall } from '../../api/client.js'
import type { Panel } from '../../registry.js'

function CallsPanel() {
  const [calls, setCalls]   = useState<ToolCall[]>([])
  const [paused, setPaused] = useState(false)
  const [error, setError]   = useState<string | null>(null)
  const pausedRef = useRef(paused)
  pausedRef.current = paused

  useEffect(() => {
    getCalls({ limit: 200 }).then(setCalls).catch(e => setError((e as Error).message))
    return subscribeEvents(event => {
      const e = event as { type: string; data: ToolCall }
      if (e.type === 'tool_call' && !pausedRef.current) {
        setCalls(prev => [e.data, ...prev].slice(0, 200))
      }
    })
  }, [])

  if (error) return <p style={{ color: '#ef4444' }}>Failed to load: {error}</p>

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <h1 style={{ fontSize: 18, fontWeight: 600 }}>Call Log</h1>
        <button
          onClick={() => setPaused(p => !p)}
          style={{
            padding: '3px 10px', borderRadius: 4, fontSize: 11, cursor: 'pointer',
            background: paused ? '#1f2937' : '#064e3b',
            color: paused ? '#9ca3af' : '#34d399',
            border: 'none'
          }}
        >
          {paused ? '▶ Resume' : '⏸ Pause'}
        </button>
        <span style={{ color: '#6b7280', fontSize: 12 }}>{calls.length} calls</span>
      </div>
      {calls.length === 0
        ? <p style={{ color: '#6b7280' }}>No tool calls recorded yet.</p>
        : (
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: '#6b7280', textAlign: 'left', borderBottom: '1px solid #1f2937' }}>
                <th style={{ paddingBottom: 8, paddingRight: 12 }}>Time</th>
                <th style={{ paddingBottom: 8, paddingRight: 12 }}>Server</th>
                <th style={{ paddingBottom: 8, paddingRight: 12 }}>Tool</th>
                <th style={{ paddingBottom: 8, paddingRight: 12 }}>Duration</th>
                <th style={{ paddingBottom: 8 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {calls.map(c => (
                <tr key={c.id} style={{ borderBottom: '1px solid #0d1117' }}>
                  <td style={{ padding: '8px 12px 8px 0', color: '#6b7280' }}>
                    {new Date(c.ts).toLocaleTimeString()}
                  </td>
                  <td style={{ paddingRight: 12, fontFamily: 'monospace', color: '#9ca3af' }}>
                    {c.server_id}
                  </td>
                  <td style={{ paddingRight: 12, fontFamily: 'monospace' }}>{c.tool_name}</td>
                  <td style={{ paddingRight: 12, color: '#9ca3af' }}>
                    {c.duration_ms != null ? `${c.duration_ms}ms` : '—'}
                  </td>
                  <td>
                    {c.success
                      ? <span style={{ color: '#10b981', fontSize: 11 }}>ok</span>
                      : <span style={{ color: '#ef4444', fontSize: 11 }} title={c.error_msg ?? ''}>error</span>
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      }
    </div>
  )
}

export const panel: Panel = {
  id: 'calls',
  label: 'Call Log',
  route: '/calls',
  component: CallsPanel,
  order: 2
}
