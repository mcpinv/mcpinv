import { describe, it, expect } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import {
  openAnalyticsDb, upsertSession, upsertRoundtrip, insertAnalyticsToolCall,
  getFileHash, listSessions, listRoundtrips, listAnalyticsToolCalls, deleteSession
} from '../src/analytics-db.js'

function freshDb() {
  return openAnalyticsDb(join(tmpdir(), `analytics-test-${randomUUID()}.db`))
}

describe('analytics-db', () => {
  it('creates schema tables on open', () => {
    const db = freshDb()
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as { name: string }[]
    const names = tables.map(t => t.name)
    expect(names).toContain('sessions')
    expect(names).toContain('roundtrips')
    expect(names).toContain('analytics_tool_calls')
    db.close()
  })

  it('upsertSession inserts and replaces on same id', () => {
    const db = freshDb()
    const session = { id: 'sess-1', provider: 'claude-code', source_path: '/a/b.jsonl', file_hash: 'abc', started_at: 1000, ended_at: 2000 }
    upsertSession(db, session)
    upsertSession(db, { ...session, file_hash: 'xyz' })
    const rows = listSessions(db)
    expect(rows).toHaveLength(1)
    expect(rows[0].file_hash).toBe('xyz')
    db.close()
  })

  it('getFileHash returns null for unknown path', () => {
    const db = freshDb()
    expect(getFileHash(db, '/no/such/path.jsonl')).toBeNull()
    db.close()
  })

  it('getFileHash returns stored hash', () => {
    const db = freshDb()
    upsertSession(db, { id: 's1', provider: 'claude-code', source_path: '/x.jsonl', file_hash: 'hash1', started_at: null, ended_at: null })
    expect(getFileHash(db, '/x.jsonl')).toBe('hash1')
    db.close()
  })

  it('deleteSession cascades to roundtrips and tool calls', () => {
    const db = freshDb()
    upsertSession(db, { id: 's1', provider: 'claude-code', source_path: '/x.jsonl', file_hash: 'h', started_at: null, ended_at: null })
    upsertRoundtrip(db, { id: 'r1', session_id: 's1', sequence_nr: 1, human_tokens: 10, assistant_tokens: 20, tool_call_count: 1, significance_score: 1, started_at: null, duration_ms: null })
    insertAnalyticsToolCall(db, { id: 'tc1', roundtrip_id: 'r1', tool_name: 'read_file', duration_ms: 50, success: 1 })
    deleteSession(db, 's1')
    expect(listSessions(db)).toHaveLength(0)
    expect(listRoundtrips(db, 's1')).toHaveLength(0)
    expect(listAnalyticsToolCalls(db, 'r1')).toHaveLength(0)
    db.close()
  })
})
