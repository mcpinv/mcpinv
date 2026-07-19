import { useEffect, useState } from 'react'
import { getCollectorConfig, putCollectorConfig, postCollectorIngest } from '../api/client.js'
import type { CollectorConfig } from '../api/client.js'

export function CollectorToggle() {
  const [config, setConfig] = useState<CollectorConfig | null>(null)
  const [ingesting, setIngesting] = useState(false)

  useEffect(() => {
    getCollectorConfig().then(setConfig).catch(() => {})
  }, [])

  const toggle = async () => {
    if (!config) return
    const updated = await putCollectorConfig({ ...config, enabled: !config.enabled })
    setConfig(updated)
  }

  const toggleDir = async (path: string) => {
    if (!config) return
    const updated = await putCollectorConfig({
      ...config,
      dirs: config.dirs.map(d => d.path === path ? { ...d, enabled: !d.enabled } : d),
    })
    setConfig(updated)
  }

  const handleIngest = async () => {
    setIngesting(true)
    try {
      await postCollectorIngest()
    } finally {
      setIngesting(false)
    }
  }

  if (!config) return null

  return (
    <div style={{ fontSize: '0.85rem' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
        <input type="checkbox" checked={config.enabled} onChange={toggle} />
        Auto Session Collector
      </label>

      {config.enabled && config.dirs.length > 0 && (
        <div
          style={{
            marginTop: '0.5rem',
            paddingLeft: '0.5rem',
            borderLeft: '2px solid var(--color-border, #333)',
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: '0.25rem', color: 'var(--color-text-secondary, #888)' }}>
            Transcript directories:
          </div>
          {config.dirs.map(d => (
            <label
              key={d.path}
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', marginBottom: '0.2rem' }}
            >
              <input type="checkbox" checked={d.enabled} onChange={() => toggleDir(d.path)} />
              <span style={{ fontSize: '0.78rem', wordBreak: 'break-all' }}>{d.path}</span>
            </label>
          ))}
          <button
            onClick={handleIngest}
            disabled={ingesting}
            style={{ marginTop: '0.5rem', padding: '0.2rem 0.6rem', fontSize: '0.78rem', cursor: 'pointer' }}
          >
            {ingesting ? 'Importing…' : 'Import now'}
          </button>
        </div>
      )}
    </div>
  )
}
