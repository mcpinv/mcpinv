import { describe, it, expect, afterEach } from 'vitest'
import { openDb, insertToolCall, ToolCallRow } from '../src/db.js'
import { unlinkSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const TEST_DB = join(tmpdir(), `mcpinv-test-${randomUUID()}.db`)

afterEach(() => { if (existsSync(TEST_DB)) unlinkSync(TEST_DB) })

describe('openDb', () => {
  it('creates schema on first open', () => {
    const db = openDb(TEST_DB)
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
    const names = (tables as { name: string }[]).map(t => t.name)
    expect(names).toContain('tool_calls')
    expect(names).toContain('schema_version')
    db.close()
  })

  it('is idempotent — second open does not throw', () => {
    const db1 = openDb(TEST_DB); db1.close()
    expect(() => { const db2 = openDb(TEST_DB); db2.close() }).not.toThrow()
  })
})

describe('insertToolCall', () => {
  it('inserts a row and returns its id', () => {
    const db = openDb(TEST_DB)
    const id = insertToolCall(db, {
      ts: Date.now(),
      server_id: 'test-server',
      tool_name: 'read_file',
      args_hash: 'abc123',
      duration_ms: 42,
      input_tokens: null,
      output_tokens: null,
      success: 1,
      error_msg: null
    })
    expect(id).toBeGreaterThan(0)
    const row = db.prepare('SELECT * FROM tool_calls WHERE id = ?').get(id) as ToolCallRow
    expect(row.tool_name).toBe('read_file')
    expect(row.success).toBe(1)
    expect(row.id).toBe(id)
    db.close()
  })
})
