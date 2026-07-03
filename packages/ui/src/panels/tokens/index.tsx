import { useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { getTokenSummary, getTokensDaily, type TokenSummary, type DailyBucket } from '../../api/client.js'
import type { Panel } from '../../registry.js'

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ padding: '16px 20px', background: '#111827', borderRadius: 8, minWidth: 140 }}>
      <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700 }}>{value}</div>
    </div>
  )
}

function TokensPanel() {
  const [summary, setSummary] = useState<TokenSummary | null>(null)
  const [daily, setDaily]     = useState<DailyBucket[]>([])
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    Promise.all([getTokenSummary(), getTokensDaily(14)])
      .then(([s, d]) => { setSummary(s); setDaily(d) })
      .catch(e => setError((e as Error).message))
  }, [])

  if (error)    return <p style={{ color: '#ef4444' }}>Failed to load: {error}</p>
  if (!summary) return <p style={{ color: '#6b7280' }}>Loading…</p>

  return (
    <div>
      <h1 style={{ fontSize: 18, fontWeight: 600, marginBottom: 20 }}>Token Usage</h1>

      <div style={{ display: 'flex', gap: 12, marginBottom: 32, flexWrap: 'wrap' }}>
        <Stat label="Total calls" value={summary.total_calls} />
        <Stat
          label="Input tokens"
          value={summary.total_input_tokens != null
            ? summary.total_input_tokens.toLocaleString()
            : '—'}
        />
        <Stat label="Top tool" value={summary.top_tool?.name ?? '—'} />
        {summary.top_tool && (
          <Stat label="Top tool calls" value={summary.top_tool.calls} />
        )}
      </div>

      <h2 style={{ fontSize: 14, fontWeight: 600, color: '#9ca3af', marginBottom: 8 }}>
        Calls per day (last 14 days)
      </h2>
      <p style={{ fontSize: 11, color: '#6b7280', marginBottom: 16 }}>
        Token counts show as — until MCP usage reporting is supported by your servers.
      </p>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={daily} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} />
          <Tooltip
            contentStyle={{ background: '#111827', border: '1px solid #1f2937', fontSize: 12 }}
            labelStyle={{ color: '#9ca3af' }}
          />
          <Bar dataKey="calls" fill="#3b82f6" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export const panel: Panel = {
  id: 'tokens',
  label: 'Token Usage',
  route: '/tokens',
  component: TokensPanel,
  order: 3
}
