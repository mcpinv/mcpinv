import { describe, it, expect } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdirSync, writeFileSync } from 'fs'
import { randomUUID } from 'crypto'
import { openAnalyticsDb } from '../src/analytics-db.js'
import { SessionCollector } from '../src/session-collector.js'

function freshDb() {
  return openAnalyticsDb(join(tmpdir(), `analytics-test-${randomUUID()}.db`))
}

describe('SessionCollector', () => {
  it('ingestAll ingests jsonl files from enabled dirs', async () => {
    const db = freshDb()
    const dir = join(tmpdir(), `sc-test-${randomUUID()}`)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'session.jsonl'), [
      JSON.stringify({ type: 'user', message: { content: 'hi' }, timestamp: '2026-01-01T00:00:00Z', usage: { input_tokens: 5 } }),
      JSON.stringify({ type: 'assistant', message: { content: 'hello' }, timestamp: '2026-01-01T00:00:01Z', usage: { output_tokens: 10 } }),
    ].join('\n'))

    const collector = new SessionCollector(db, {
      enabled: true,
      dirs: [{ path: dir, enabled: true, auto: false }]
    })

    const result = await collector.ingestAll()
    expect(result.ingested).toBe(1)
    expect(result.skipped).toBe(0)
    db.close()
  })

  it('ingestAll skips disabled dirs', async () => {
    const db = freshDb()
    const dir = join(tmpdir(), `sc-test-${randomUUID()}`)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'session.jsonl'), JSON.stringify({ type: 'user', message: { content: 'x' }, timestamp: '2026-01-01T00:00:00Z', usage: { input_tokens: 1 } }))

    const collector = new SessionCollector(db, {
      enabled: true,
      dirs: [{ path: dir, enabled: false, auto: false }]
    })

    const result = await collector.ingestAll()
    expect(result.ingested).toBe(0)
    db.close()
  })

  it('getStatus returns enabled dirs', () => {
    const db = freshDb()
    const collector = new SessionCollector(db, {
      enabled: true,
      dirs: [{ path: '/some/dir', enabled: true, auto: false }]
    })
    const status = collector.getStatus()
    expect(status.enabled).toBe(true)
    expect(status.watchedDirs).toContain('/some/dir')
    db.close()
  })

  it('ingestAll returns skipped=1 on second identical run', async () => {
    const db = freshDb()
    const dir = join(tmpdir(), `sc-test-${randomUUID()}`)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'session.jsonl'), [
      JSON.stringify({ type: 'user', message: { content: 'hi' }, timestamp: '2026-01-01T00:00:00Z', usage: { input_tokens: 5 } }),
      JSON.stringify({ type: 'assistant', message: { content: 'hello' }, timestamp: '2026-01-01T00:00:01Z', usage: { output_tokens: 10 } }),
    ].join('\n'))

    const collector = new SessionCollector(db, {
      enabled: true,
      dirs: [{ path: dir, enabled: true, auto: false }]
    })

    await collector.ingestAll()
    const result = await collector.ingestAll()
    expect(result.skipped).toBe(1)
    expect(result.ingested).toBe(0)
    db.close()
  })

  it('getStatus lastRunAt is null before first run', () => {
    const db = freshDb()
    const collector = new SessionCollector(db, {
      enabled: false,
      dirs: []
    })
    expect(collector.getStatus().lastRunAt).toBeNull()
    db.close()
  })

  it('updateConfig disables watcher when enabled=false', () => {
    const db = freshDb()
    const collector = new SessionCollector(db, {
      enabled: true,
      dirs: []
    })
    collector.updateConfig({ enabled: false, dirs: [] })
    expect(collector.getStatus().enabled).toBe(false)
    db.close()
  })
})
