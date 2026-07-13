import { describe, it, expect, afterEach } from 'vitest'
import Database from 'better-sqlite3'
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
  let dbPath: string
  afterEach(() => { if (existsSync(dbPath)) unlinkSync(dbPath) })

  it('known_servers table has last_port column after openDb', () => {
    dbPath = join(tmpdir(), `mcpinv-test-${randomUUID()}.db`)
    const db = openDb(dbPath)
    upsertKnownServer(db, 'srv-a')
    const row = db.prepare('SELECT last_port FROM known_servers WHERE id = ?').get('srv-a') as any
    expect(row).toBeDefined()
    expect(row.last_port).toBeNull()
    db.close()
  })

  it('schema_version is 2 after openDb', () => {
    dbPath = join(tmpdir(), `mcpinv-test-${randomUUID()}.db`)
    const db = openDb(dbPath)
    const v = (db.prepare('SELECT version FROM schema_version').get() as { version: number }).version
    expect(v).toBe(2)
    db.close()
  })

  it('migrates an existing v1 database to v2 (adds last_port column)', () => {
    dbPath = join(tmpdir(), `mcpinv-v1-migrate-${randomUUID()}.db`)

    // Create a v1 database manually (simulates existing user DB before upgrade)
    const v1db = new Database(dbPath)
    v1db.exec(`
      CREATE TABLE known_servers (id TEXT PRIMARY KEY, registered_at INTEGER, last_seen_at INTEGER);
      CREATE TABLE tool_calls (id INTEGER PRIMARY KEY AUTOINCREMENT, server_id TEXT NOT NULL, tool_name TEXT NOT NULL, ts INTEGER NOT NULL, duration_ms INTEGER, error TEXT);
      CREATE TABLE schema_version (version INTEGER NOT NULL PRIMARY KEY);
      INSERT INTO schema_version VALUES (1);
    `)
    v1db.prepare('INSERT INTO known_servers (id, registered_at) VALUES (?, ?)').run('existing-srv', Date.now())
    v1db.close()

    // Now open with the current openDb — should migrate cleanly
    const db = openDb(dbPath)

    // Verify last_port column exists
    const row = db.prepare('SELECT last_port FROM known_servers WHERE id = ?').get('existing-srv') as any
    expect(row).toBeDefined()
    expect(row.last_port).toBeNull()

    // Verify schema version bumped to 2
    const version = (db.prepare('SELECT version FROM schema_version').get() as { version: number }).version
    expect(version).toBe(2)

    db.close()
  })
})

describe('updateLastPort', () => {
  let dbPath: string
  afterEach(() => { if (existsSync(dbPath)) unlinkSync(dbPath) })

  it('sets last_port for known server', () => {
    dbPath = join(tmpdir(), `mcpinv-test-${randomUUID()}.db`)
    const db = openDb(dbPath)
    upsertKnownServer(db, 'srv-b')
    updateLastPort(db, 'srv-b', 3042)
    const known = listKnownServers(db)
    expect(known.find(s => s.id === 'srv-b')?.last_port).toBe(3042)
    db.close()
  })

  it('listKnownServers includes last_port', () => {
    dbPath = join(tmpdir(), `mcpinv-test-${randomUUID()}.db`)
    const db = openDb(dbPath)
    upsertKnownServer(db, 'srv-c')
    const before = listKnownServers(db)
    expect(before[0]).toHaveProperty('last_port')
    db.close()
  })
})
