import { describe, it, expect, afterEach } from 'vitest'
import { openDb, insertToolCall, upsertKnownServer, listKnownServers, updateLastPort, ToolCallRow } from '../src/db.js'
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

describe('upsertKnownServer', () => {
  it('upsertKnownServer inserts a new server', () => {
    const db = openDb(join(tmpdir(), `mcpinv-test-${randomUUID()}.db`))
    upsertKnownServer(db, 'mira-local')
    const rows = listKnownServers(db)
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('mira-local')
    expect(rows[0].registered_at).toBeGreaterThan(0)
    expect(rows[0].last_seen_at).toBeNull()
    db.close()
  })

  it('upsertKnownServer is idempotent', () => {
    const db = openDb(join(tmpdir(), `mcpinv-test-${randomUUID()}.db`))
    upsertKnownServer(db, 'mira-local')
    upsertKnownServer(db, 'mira-local')
    expect(listKnownServers(db)).toHaveLength(1)
    db.close()
  })

  it('listKnownServers returns all registered servers', () => {
    const db = openDb(join(tmpdir(), `mcpinv-test-${randomUUID()}.db`))
    upsertKnownServer(db, 'mira-local')
    upsertKnownServer(db, 'mira-memory')
    const ids = listKnownServers(db).map(r => r.id)
    expect(ids).toContain('mira-local')
    expect(ids).toContain('mira-memory')
    db.close()
  })
})

describe('last_port migration', () => {
  it('known_servers table has last_port column after openDb', () => {
    const db = openDb(join(tmpdir(), `mcpinv-test-${randomUUID()}.db`))
    upsertKnownServer(db, 'srv-a')
    const row = db.prepare('SELECT last_port FROM known_servers WHERE id = ?').get('srv-a') as any
    expect(row).toBeDefined()
    expect(row.last_port).toBeNull()
    db.close()
  })

  it('schema_version is 2 after openDb', () => {
    const db = openDb(join(tmpdir(), `mcpinv-test-${randomUUID()}.db`))
    const v = (db.prepare('SELECT version FROM schema_version').get() as { version: number }).version
    expect(v).toBe(2)
    db.close()
  })
})

describe('updateLastPort', () => {
  it('sets last_port for known server', () => {
    const db = openDb(join(tmpdir(), `mcpinv-test-${randomUUID()}.db`))
    upsertKnownServer(db, 'srv-b')
    updateLastPort(db, 'srv-b', 3042)
    const known = listKnownServers(db)
    expect(known.find(s => s.id === 'srv-b')?.last_port).toBe(3042)
    db.close()
  })

  it('listKnownServers includes last_port', () => {
    const db = openDb(join(tmpdir(), `mcpinv-test-${randomUUID()}.db`))
    upsertKnownServer(db, 'srv-c')
    const before = listKnownServers(db)
    expect(before[0]).toHaveProperty('last_port')
    db.close()
  })
})
