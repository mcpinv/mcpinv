import { useEffect, useRef, useState } from 'react'
import { subscribeEvents } from '../../api/client.js'
import type { Panel } from '../../registry.js'

interface LiveToolCall {
  tool_name: string
  server_id: string
  duration_ms: number
  success: boolean
  ts: number
}

interface LiveRoundtrip {
  id: string
  startedAt: number
  toolCalls: LiveToolCall[]
  active: boolean
}

const ROUNDTRIP_GAP_MS = 2000

export function MonitorPanel() {
  const [roundtrips, setRoundtrips] = useState<LiveRoundtrip[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const lastTsRef = useRef<number>(0)

  useEffect(() => {
    return subscribeEvents((event) => {
      const e = event as { type: string; data?: LiveToolCall }
      if (e.type !== 'tool_call' || !e.data) return
      const now = Date.now()

      setRoundtrips(prev => {
        const gap = now - lastTsRef.current
        lastTsRef.current = now
        const last = prev[prev.length - 1]

        if (!last || !last.active || gap > ROUNDTRIP_GAP_MS) {
          const newRt: LiveRoundtrip = {
            id: String(now),
            startedAt: now,
            toolCalls: [e.data!],
            active: true,
          }
          const updated = prev.map(r => ({ ...r, active: false }))
          return [...updated, newRt]
        }

        return prev.map(r =>
          r.id === last.id
            ? { ...r, toolCalls: [...r.toolCalls, e.data!] }
            : r
        )
      })
    })
  }, [])

  const displayRoundtrips = [...roundtrips].reverse()
  const selectedRt = selected
    ? roundtrips.find(r => r.id === selected)
    : roundtrips[roundtrips.length - 1]

  if (roundtrips.length === 0) {
    return (
      <div style={{ padding: '2rem', color: 'var(--color-text-secondary, #888)' }}>
        No active tool calls — tool executions appear here in real time.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', gap: '1rem', height: '100%' }}>
      {/* Left column: roundtrip list, newest first */}
      <div style={{ width: '240px', overflowY: 'auto', borderRight: '1px solid var(--color-border, #333)' }}>
        {displayRoundtrips.map(rt => (
          <div
            key={rt.id}
            onClick={() => setSelected(rt.id)}
            style={{
              padding: '0.5rem 1rem',
              cursor: 'pointer',
              background: selectedRt?.id === rt.id ? 'var(--color-selected, #1e3a5f)' : 'transparent',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span>{rt.toolCalls.length} call{rt.toolCalls.length !== 1 ? 's' : ''}</span>
            {rt.active && selectedRt?.id === rt.id && (
              <span style={{ fontSize: '0.7rem', color: 'var(--color-accent, #4a9eff)' }}>● LIVE</span>
            )}
          </div>
        ))}
      </div>

      {/* Right column: detail view of selected roundtrip */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem' }}>
        {selectedRt ? (
          <div>
            {selectedRt.toolCalls.map((tc, i) => (
              <div
                key={i}
                style={{
                  padding: '0.4rem 0.8rem',
                  marginBottom: '0.25rem',
                  borderLeft: `3px solid ${tc.success ? 'var(--color-success, #4caf50)' : 'var(--color-error, #f44336)'}`,
                  background: 'var(--color-surface, #1a1a1a)',
                }}
              >
                <span style={{ fontWeight: 600 }}>{tc.tool_name}</span>
                <span style={{ marginLeft: '1rem', color: 'var(--color-text-secondary, #888)', fontSize: '0.85rem' }}>
                  {tc.server_id} · {tc.duration_ms}ms
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export const panel: Panel = {
  id: 'monitor',
  label: 'Live Monitor',
  route: '/monitor',
  component: MonitorPanel,
  order: 15,
}
