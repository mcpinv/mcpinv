import Database from 'better-sqlite3'
import { homedir } from 'os'
import { join, dirname } from 'path'
import { mkdirSync } from 'fs'

export interface ToolCallRow {
  id: number
  ts: number
  server_id: string
  tool_name: string
  args_hash: string
  duration_ms: number | null
  input_tokens: number | null
  output_tokens: number | null
  success: number
  error_msg: string | null
}

const DEFAULT_DB_PATH = join(homedir(), '.mcpinv', 'cockpit.db')

export function openDb(path = DEFAULT_DB_PATH): Database.Database {
  mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS tool_calls (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      ts            INTEGER NOT NULL,
      server_id     TEXT    NOT NULL,
      tool_name     TEXT    NOT NULL,
      args_hash     TEXT    NOT NULL,
      duration_ms   INTEGER,
      input_tokens  INTEGER,
      output_tokens INTEGER,
      success       INTEGER NOT NULL,
      error_msg     TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_tc_ts     ON tool_calls(ts);
    CREATE INDEX IF NOT EXISTS idx_tc_server ON tool_calls(server_id);
    CREATE INDEX IF NOT EXISTS idx_tc_tool   ON tool_calls(tool_name);
    CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL PRIMARY KEY);
    INSERT OR IGNORE INTO schema_version VALUES (1);
  `)
  return db
}

const _stmtCache = new WeakMap<Database.Database, Database.Statement>()

function getInsertStmt(db: Database.Database): Database.Statement {
  let stmt = _stmtCache.get(db)
  if (!stmt) {
    stmt = db.prepare(`
      INSERT INTO tool_calls
        (ts, server_id, tool_name, args_hash, duration_ms, input_tokens, output_tokens, success, error_msg)
      VALUES
        (@ts, @server_id, @tool_name, @args_hash, @duration_ms, @input_tokens, @output_tokens, @success, @error_msg)
    `)
    _stmtCache.set(db, stmt)
  }
  return stmt
}

export function insertToolCall(db: Database.Database, row: Omit<ToolCallRow, 'id'>): number {
  // Safe for any realistic row count; BigInt precision lost above 2^53 rows
  return Number(getInsertStmt(db).run(row).lastInsertRowid)
}
