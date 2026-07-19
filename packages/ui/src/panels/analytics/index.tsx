import { useEffect, useState } from 'react'
import { getSessions, getRoundtrips } from '../../api/client.js'
import type { SessionRow, RoundtripRow } from '../../api/client.js'
import type { Panel } from '../../registry.js'

const SIGNIFICANCE_COLORS: Record<number, string> = {
  0: '#6b7280',
  1: '#3b82f6',
  2: '#f59e0b',
  3: '#22c55e',
}

const SIGNIFICANCE_LABELS = ['Routine', 'Active', 'Relevant', 'Key moment']

export function AnalyticsPanel() {
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [selectedSession, setSelectedSession] = useState<string | null>(null)
  const [roundtrips, setRoundtrips] = useState<RoundtripRow[]>([])
  const [selectedRt, setSelectedRt] = useState<RoundtripRow | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getSessions()
      .then(s => {
        setSessions(s)
        if (s.length > 0) setSelectedSession(s[0].id)
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!selectedSession) return
    getRoundtrips(selectedSession).then(setRoundtrips)
    setSelectedRt(null)
  }, [selectedSession])

  const maxTokens = Math.max(
    ...roundtrips.map(r => (r.human_tokens ?? 0) + (r.assistant_tokens ?? 0)),
    1,
  )

  if (loading) return <div style={{ padding: '2rem' }}>Loading…</div>

  if (sessions.length === 0) {
    return (
      <div style={{ padding: '2rem', color: 'var(--color-text-secondary, #888)' }}>
        No sessions collected yet. Enable Auto Session Collector in the header to start.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '1rem', gap: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <label style={{ fontWeight: 600 }}>Session</label>
        <select
          value={selectedSession ?? ''}
          onChange={e => setSelectedSession(e.target.value)}
          style={{
            padding: '0.3rem 0.5rem',
            background: 'var(--color-surface, #1a1a1a)',
            color: 'inherit',
            border: '1px solid var(--color-border, #333)',
            borderRadius: '4px',
          }}
        >
          {sessions.map(s => (
            <option key={s.id} value={s.id}>
              {s.source_path.split('/').slice(-2).join('/')} ·{' '}
              {s.started_at ? new Date(s.started_at).toLocaleDateString() : '?'}
            </option>
          ))}
        </select>
      </div>

      <div style={{ display: 'flex', gap: '1rem', flex: 1, overflow: 'hidden' }}>
        {/* Timeline */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {roundtrips.map(rt => {
            const tokens = (rt.human_tokens ?? 0) + (rt.assistant_tokens ?? 0)
            const widthPct = Math.max(4, Math.round((tokens / maxTokens) * 100))
            const color = SIGNIFICANCE_COLORS[rt.significance_score] ?? SIGNIFICANCE_COLORS[0]
            const isSelected = selectedRt?.id === rt.id
            return (
              <div key={rt.id} onClick={() => setSelectedRt(rt)} style={{ marginBottom: '0.35rem', cursor: 'pointer' }}>
                <div
                  style={{
                    width: `${widthPct}%`,
                    height: '28px',
                    background: color,
                    borderRadius: '3px',
                    display: 'flex',
                    alignItems: 'center',
                    paddingLeft: '0.5rem',
                    fontSize: '0.8rem',
                    color: '#fff',
                    opacity: isSelected ? 1 : 0.75,
                    outline: isSelected ? `2px solid ${color}` : 'none',
                  }}
                >
                  #{rt.sequence_nr} · {rt.tool_call_count > 0 ? `${rt.tool_call_count} tools` : `${tokens} tok`}
                </div>
              </div>
            )
          })}
        </div>

        {/* Detail drawer */}
        {selectedRt && (
          <div
            style={{
              width: '320px',
              background: 'var(--color-surface, #1a1a1a)',
              borderRadius: '6px',
              padding: '1rem',
              overflowY: 'auto',
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>
              Roundtrip #{selectedRt.sequence_nr}
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary, #888)', marginBottom: '0.75rem' }}>
              {selectedRt.human_tokens ?? 0} human · {selectedRt.assistant_tokens ?? 0} assistant tokens
              {selectedRt.duration_ms != null ? ` · ${(selectedRt.duration_ms / 1000).toFixed(1)}s` : ''}
            </div>
            <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.25rem' }}>
              Significance: {SIGNIFICANCE_LABELS[selectedRt.significance_score] ?? 'Unknown'}
            </div>
            <div style={{ fontSize: '0.8rem' }}>
              Tool calls: {selectedRt.tool_call_count}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export const panel: Panel = {
  id: 'analytics',
  label: 'Session Analytics',
  route: '/analytics',
  component: AnalyticsPanel,
  order: 20,
}
