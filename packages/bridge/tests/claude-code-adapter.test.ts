import { describe, it, expect } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { writeFileSync } from 'fs'
import { randomUUID } from 'crypto'
import { openAnalyticsDb, listSessions, listRoundtrips, listAnalyticsToolCalls } from '../src/analytics-db.js'
import { ClaudeCodeAdapter } from '../src/claude-code-adapter.js'

function makeTmpFile(lines: object[]): string {
  const path = join(tmpdir(), `transcript-${randomUUID()}.jsonl`)
  writeFileSync(path, lines.map(l => JSON.stringify(l)).join('\n'))
  return path
}

function freshDb() {
  return openAnalyticsDb(join(tmpdir(), `analytics-test-${randomUUID()}.db`))
}

describe('ClaudeCodeAdapter', () => {
  it('ingests a simple two-roundtrip transcript', async () => {
    const db = freshDb()
    const adapter = new ClaudeCodeAdapter(db)
    const path = makeTmpFile([
      { type: 'user', message: { content: 'hello' }, timestamp: '2026-01-01T00:00:00Z', usage: { input_tokens: 10 } },
      { type: 'assistant', message: { content: 'world' }, timestamp: '2026-01-01T00:00:01Z', usage: { output_tokens: 20 } },
      { type: 'user', message: { content: 'second' }, timestamp: '2026-01-01T00:00:02Z', usage: { input_tokens: 5 } },
      { type: 'assistant', message: { content: 'reply' }, timestamp: '2026-01-01T00:00:03Z', usage: { output_tokens: 8 } },
    ])

    const result = await adapter.ingest(path)
    expect(result.skipped).toBe(false)
    expect(result.roundtripsWritten).toBe(2)
    expect(result.toolCallsWritten).toBe(0)

    const sessions = listSessions(db)
    expect(sessions).toHaveLength(1)
    const roundtrips = listRoundtrips(db, sessions[0].id)
    expect(roundtrips).toHaveLength(2)
    expect(roundtrips[0].human_tokens).toBe(10)
    expect(roundtrips[0].assistant_tokens).toBe(20)
    db.close()
  })

  it('skips unchanged file on second ingest', async () => {
    const db = freshDb()
    const adapter = new ClaudeCodeAdapter(db)
    const path = makeTmpFile([
      { type: 'user', message: { content: 'hi' }, timestamp: '2026-01-01T00:00:00Z', usage: { input_tokens: 3 } },
      { type: 'assistant', message: { content: 'there' }, timestamp: '2026-01-01T00:00:01Z', usage: { output_tokens: 5 } },
    ])

    await adapter.ingest(path)
    const result2 = await adapter.ingest(path)
    expect(result2.skipped).toBe(true)
    expect(listSessions(db)).toHaveLength(1)
    db.close()
  })

  it('records tool calls and computes significance_score', async () => {
    const db = freshDb()
    const adapter = new ClaudeCodeAdapter(db)
    const path = makeTmpFile([
      { type: 'user', message: { content: 'write something' }, timestamp: '2026-01-01T00:00:00Z', usage: { input_tokens: 15 } },
      { type: 'assistant', message: { content: 'ok' }, timestamp: '2026-01-01T00:00:01Z', usage: { output_tokens: 50 } },
      { type: 'tool_use', name: 'write_file', timestamp: '2026-01-01T00:00:02Z' },
      { type: 'tool_result', duration_ms: 30, is_error: false },
      { type: 'tool_use', name: 'bash', timestamp: '2026-01-01T00:00:03Z' },
      { type: 'tool_result', duration_ms: 100, is_error: false },
      { type: 'tool_use', name: 'read_file', timestamp: '2026-01-01T00:00:04Z' },
      { type: 'tool_result', duration_ms: 10, is_error: false },
    ])

    const result = await adapter.ingest(path)
    expect(result.toolCallsWritten).toBe(3)

    const sessions = listSessions(db)
    const roundtrips = listRoundtrips(db, sessions[0].id)
    expect(roundtrips[0].tool_call_count).toBe(3)
    // +1 write_file matches pattern, +1 tool_call_count>=3 = score 2 (only 1 roundtrip so top-quartile doesn't apply)
    expect(roundtrips[0].significance_score).toBeGreaterThanOrEqual(2)
    db.close()
  })
})
