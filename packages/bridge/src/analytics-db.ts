import Database from 'better-sqlite3'
import { homedir } from 'os'
import { join, dirname } from 'path'
import { mkdirSync } from 'fs'

const DEFAULT_PATH = join(homedir(), '.mcpinv', 'analytics.db')

export interface SessionRow {
  id: string
  provider: string
  source_path: string
  file_hash: string
  started_at: number | null
  ended_at: number | null
}

export interface RoundtripRow {
  id: string
  session_id: string
  sequence_nr: number
  human_tokens: number | null
  assistant_tokens: number | null
  tool_call_count: number
  significance_score: number
  started_at: number | null
  duration_ms: number | null
}

export interface AnalyticsToolCallRow {
  id: string
  roundtrip_id: string
  tool_name: string
  duration_ms: number | null
  success: number
}

export function openAnalyticsDb(path = DEFAULT_PATH): Database.Database {
  mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id           TEXT PRIMARY KEY,
      provider     TEXT NOT NULL,
      source_path  TEXT NOT NULL,
      file_hash    TEXT NOT NULL,
      started_at   INTEGER,
      ended_at     INTEGER
    );
    CREATE TABLE IF NOT EXISTS roundtrips (
      id                 TEXT PRIMARY KEY,
      session_id         TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      sequence_nr        INTEGER NOT NULL,
      human_tokens       INTEGER,
      assistant_tokens   INTEGER,
      tool_call_count    INTEGER NOT NULL DEFAULT 0,
      significance_score INTEGER NOT NULL DEFAULT 0,
      started_at         INTEGER,
      duration_ms        INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_rt_session ON roundtrips(session_id);
    CREATE TABLE IF NOT EXISTS analytics_tool_calls (
      id           TEXT PRIMARY KEY,
      roundtrip_id TEXT NOT NULL REFERENCES roundtrips(id) ON DELETE CASCADE,
      tool_name    TEXT NOT NULL,
      duration_ms  INTEGER,
      success      INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_atc_roundtrip ON analytics_tool_calls(roundtrip_id);
    PRAGMA foreign_keys = ON;
  `)
  return db
}

export function upsertSession(db: Database.Database, row: SessionRow): void {
  db.prepare(`
    INSERT INTO sessions (id, provider, source_path, file_hash, started_at, ended_at)
    VALUES (@id, @provider, @source_path, @file_hash, @started_at, @ended_at)
    ON CONFLICT(id) DO UPDATE SET
      file_hash = excluded.file_hash,
      started_at = excluded.started_at,
      ended_at = excluded.ended_at
  `).run(row)
}

export function upsertRoundtrip(db: Database.Database, row: RoundtripRow): void {
  db.prepare(`
    INSERT INTO roundtrips
      (id, session_id, sequence_nr, human_tokens, assistant_tokens, tool_call_count, significance_score, started_at, duration_ms)
    VALUES
      (@id, @session_id, @sequence_nr, @human_tokens, @assistant_tokens, @tool_call_count, @significance_score, @started_at, @duration_ms)
    ON CONFLICT(id) DO UPDATE SET
      human_tokens = excluded.human_tokens,
      assistant_tokens = excluded.assistant_tokens,
      tool_call_count = excluded.tool_call_count,
      significance_score = excluded.significance_score,
      duration_ms = excluded.duration_ms
  `).run(row)
}

export function insertAnalyticsToolCall(db: Database.Database, row: AnalyticsToolCallRow): void {
  db.prepare(`
    INSERT OR IGNORE INTO analytics_tool_calls (id, roundtrip_id, tool_name, duration_ms, success)
    VALUES (@id, @roundtrip_id, @tool_name, @duration_ms, @success)
  `).run(row)
}

export function getFileHash(db: Database.Database, sourcePath: string): string | null {
  const row = db.prepare('SELECT file_hash FROM sessions WHERE source_path = ? LIMIT 1').get(sourcePath) as { file_hash: string } | undefined
  return row?.file_hash ?? null
}

export function listSessions(db: Database.Database): SessionRow[] {
  return db.prepare('SELECT * FROM sessions ORDER BY started_at DESC').all() as SessionRow[]
}

export function listRoundtrips(db: Database.Database, sessionId: string): RoundtripRow[] {
  return db.prepare('SELECT * FROM roundtrips WHERE session_id = ? ORDER BY sequence_nr').all(sessionId) as RoundtripRow[]
}

export function listAnalyticsToolCalls(db: Database.Database, roundtripId: string): AnalyticsToolCallRow[] {
  return db.prepare('SELECT * FROM analytics_tool_calls WHERE roundtrip_id = ?').all(roundtripId) as AnalyticsToolCallRow[]
}

export function deleteSession(db: Database.Database, sessionId: string): void {
  db.pragma('foreign_keys = ON')
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId)
}
