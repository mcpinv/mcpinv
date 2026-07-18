# Analytics Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Session Analytics Panel and Live Monitor Panel to the mcpinv Cockpit, backed by a separate `analytics.db` SQLite database populated by an opt-in Claude Code transcript watcher.

**Architecture:** Four independent layers built bottom-up: (1) `analytics-db.ts` — schema + ingest helpers for `analytics.db`; (2) `ClaudeCodeAdapter` — reads JSONL transcripts, computes significance scores, writes canonical records; (3) Bridge-side `SessionCollector` — file watcher lifecycle tied to `CockpitServer`, new REST endpoints for config/status; (4) UI — toggle + config card in the shell header, two new panels (Live Monitor, Session Analytics).

**Tech Stack:** TypeScript ESM, better-sqlite3, Node.js `fs.watch` (no new npm deps), React, Vite, Vitest.

## Global Constraints

- TypeScript ESM (`"type": "module"`) — all imports use `.js` extensions
- No new npm dependencies (use Node.js built-ins: `fs.watch`, `crypto`, `os`, `path`)
- All code and comments in English
- TDD: failing test before implementation for every testable unit
- Working directory: `C:\Users\Anwender\IdeaProjects\mcpinv`
- Run bridge tests: `npm test --workspace=packages/bridge` from project root (PowerShell)
- Run UI tests: `npm test --workspace=packages/ui` from project root (PowerShell)
- Commit directly to `main` — no feature branches
- `analytics.db` path: `~/.mcpinv/analytics.db` (separate from `~/.mcpinv/cockpit.db`)

---

## File Structure

```
packages/bridge/src/analytics-db.ts        CREATE — analytics.db schema + CRUD helpers
packages/bridge/src/claude-code-adapter.ts CREATE — JSONL → canonical records
packages/bridge/src/session-collector.ts   CREATE — fs.watch lifecycle + CollectorConfig
packages/bridge/src/api-routes.ts          MODIFY — add /api/collector/* endpoints
packages/bridge/src/cockpit-server.ts      MODIFY — wire SessionCollector lifecycle
packages/bridge/tests/analytics-db.test.ts      CREATE
packages/bridge/tests/claude-code-adapter.test.ts CREATE
packages/bridge/tests/session-collector.test.ts   CREATE

packages/ui/src/api/client.ts              MODIFY — add analytics + collector API calls
packages/ui/src/panels/monitor/index.tsx   CREATE — Live Monitor panel
packages/ui/src/panels/analytics/index.tsx CREATE — Session Analytics panel
packages/ui/src/shell/Shell.tsx            CREATE — nav shell with collector toggle
packages/ui/src/registry.ts               MODIFY — register two new panels
packages/ui/src/tests/monitor.test.tsx     CREATE
packages/ui/src/tests/analytics.test.tsx   CREATE
```

---

### Task 1: `analytics-db.ts` — schema + CRUD helpers

The foundation for all later tasks. Defines the three new tables (`sessions`, `roundtrips`, `analytics_tool_calls`) and the helpers that write and query them. Does not touch `cockpit.db`.

**Files:**
- Create: `packages/bridge/src/analytics-db.ts`
- Create: `packages/bridge/tests/analytics-db.test.ts`

**Interfaces produced (used by Tasks 2 and 3):**

```typescript
export function openAnalyticsDb(path?: string): Database.Database
// default: ~/.mcpinv/analytics.db

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
  significance_score: number   // 0–3
  started_at: number | null
  duration_ms: number | null
}

export interface AnalyticsToolCallRow {
  id: string
  roundtrip_id: string
  tool_name: string
  duration_ms: number | null
  success: number              // 1=ok, 0=error
}

export function upsertSession(db: Database.Database, row: SessionRow): void
export function upsertRoundtrip(db: Database.Database, row: RoundtripRow): void
export function insertAnalyticsToolCall(db: Database.Database, row: AnalyticsToolCallRow): void
export function getFileHash(db: Database.Database, sourcePath: string): string | null
// returns file_hash for the most recent session with source_path, or null if not found
export function listSessions(db: Database.Database): SessionRow[]
export function listRoundtrips(db: Database.Database, sessionId: string): RoundtripRow[]
export function listAnalyticsToolCalls(db: Database.Database, roundtripId: string): AnalyticsToolCallRow[]
export function deleteSession(db: Database.Database, sessionId: string): void
// cascades: also deletes roundtrips and analytics_tool_calls for that session
```

- [ ] **Step 1: Write the failing tests**

Create `packages/bridge/tests/analytics-db.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
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
```

- [ ] **Step 2: Run to verify failure**

```powershell
npm test --workspace=packages/bridge -- tests/analytics-db.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Implement `analytics-db.ts`**

Create `packages/bridge/src/analytics-db.ts`:

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

```powershell
npm test --workspace=packages/bridge -- tests/analytics-db.test.ts
```
Expected: all 5 tests PASS

- [ ] **Step 5: Run full bridge suite**

```powershell
npm test --workspace=packages/bridge
```
Expected: all tests PASS

- [ ] **Step 6: Commit**

```powershell
git add packages/bridge/src/analytics-db.ts packages/bridge/tests/analytics-db.test.ts
git commit -m "feat: analytics-db — schema + CRUD helpers for analytics.db"
```

---

### Task 2: `ClaudeCodeAdapter` — JSONL → canonical records

Reads Claude Code JSONL transcript files, extracts sessions/roundtrips/tool_calls, computes significance scores, and writes to `analytics.db`. Idempotent: skips unchanged files via SHA-256 hash comparison.

**Files:**
- Create: `packages/bridge/src/claude-code-adapter.ts`
- Create: `packages/bridge/tests/claude-code-adapter.test.ts`

**Interfaces consumed (from Task 1):**
- `openAnalyticsDb`, `upsertSession`, `upsertRoundtrip`, `insertAnalyticsToolCall`, `getFileHash`, `deleteSession`

**Interfaces produced (used by Task 3):**

```typescript
export interface IngestResult {
  sessionId: string
  roundtripsWritten: number
  toolCallsWritten: number
  skipped: boolean
}

export class ClaudeCodeAdapter {
  constructor(db: Database.Database)
  ingest(filePath: string): Promise<IngestResult>
}
```

**Significance scoring logic:**
- Start at 0 for each roundtrip
- +1 if any tool call has `tool_name` matching `/\b(write|edit|create|delete|bash|execute|git)/i`
- +1 if `tool_call_count >= 3`
- +1 if `assistant_tokens` is in the top 25% of all roundtrips in this session (computed after collecting all roundtrips)

**Claude Code JSONL format** (each line is a JSON object):
```json
{ "type": "user", "message": { "content": "..." }, "timestamp": "2026-01-01T00:00:00Z", "usage": { "input_tokens": 100 } }
{ "type": "assistant", "message": { "content": "..." }, "timestamp": "2026-01-01T00:00:01Z", "usage": { "output_tokens": 200 } }
{ "type": "tool_use", "name": "read_file", "timestamp": "2026-01-01T00:00:02Z" }
{ "type": "tool_result", "duration_ms": 50, "is_error": false }
```

A "roundtrip" is one `user` entry followed by all `assistant`/`tool_use`/`tool_result` entries until the next `user` entry.

- [ ] **Step 1: Write the failing tests**

Create `packages/bridge/tests/claude-code-adapter.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run to verify failure**

```powershell
npm test --workspace=packages/bridge -- tests/claude-code-adapter.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Implement `claude-code-adapter.ts`**

Create `packages/bridge/src/claude-code-adapter.ts`:

```typescript
import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import { randomUUID } from 'crypto'
import type Database from 'better-sqlite3'
import {
  upsertSession, upsertRoundtrip, insertAnalyticsToolCall,
  getFileHash, deleteSession
} from './analytics-db.js'
import type { IngestResult } from './types.js'

export type { IngestResult }

const WRITE_TOOL_RE = /\b(write|edit|create|delete|bash|execute|git)\b/i

interface RawLine {
  type: string
  message?: { content?: string }
  timestamp?: string
  usage?: { input_tokens?: number; output_tokens?: number }
  name?: string
  duration_ms?: number
  is_error?: boolean
}

export class ClaudeCodeAdapter {
  constructor(private readonly db: Database.Database) {}

  async ingest(filePath: string): Promise<IngestResult> {
    const content = readFileSync(filePath, 'utf8')
    const hash = createHash('sha256').update(content).digest('hex')

    const storedHash = getFileHash(this.db, filePath)
    if (storedHash === hash) {
      return { sessionId: '', roundtripsWritten: 0, toolCallsWritten: 0, skipped: true }
    }

    const lines: RawLine[] = content
      .split('\n')
      .filter(l => l.trim())
      .map(l => {
        try { return JSON.parse(l) } catch { return null }
      })
      .filter(Boolean)

    // Group lines into roundtrips: each starts with a 'user' entry
    const groups: RawLine[][] = []
    for (const line of lines) {
      if (line.type === 'user') {
        groups.push([line])
      } else if (groups.length > 0) {
        groups[groups.length - 1].push(line)
      }
    }

    if (groups.length === 0) {
      return { sessionId: '', roundtripsWritten: 0, toolCallsWritten: 0, skipped: false }
    }

    const firstTs = groups[0][0].timestamp ? new Date(groups[0][0].timestamp).getTime() : null
    const lastGroup = groups[groups.length - 1]
    const lastLine = lastGroup[lastGroup.length - 1]
    const lastTs = lastLine.timestamp ? new Date(lastLine.timestamp).getTime() : null

    const sessionId = createHash('sha256').update(filePath + (firstTs ?? '')).digest('hex').slice(0, 16)

    // Delete old records if hash changed (file was modified)
    if (storedHash !== null) {
      deleteSession(this.db, sessionId)
    }

    upsertSession(this.db, {
      id: sessionId,
      provider: 'claude-code',
      source_path: filePath,
      file_hash: hash,
      started_at: firstTs,
      ended_at: lastTs
    })

    // First pass: collect raw roundtrip data
    const rawRoundtrips = groups.map((group, i) => {
      const userLine = group[0]
      const humanTokens = userLine.usage?.input_tokens ?? null
      const assistantLine = group.find(l => l.type === 'assistant')
      const assistantTokens = assistantLine?.usage?.output_tokens ?? null
      const toolUses = group.filter(l => l.type === 'tool_use')
      const toolResults = group.filter(l => l.type === 'tool_result')
      const startTs = userLine.timestamp ? new Date(userLine.timestamp).getTime() : null
      const lastLineTs = group[group.length - 1].timestamp ? new Date(group[group.length - 1].timestamp).getTime() : null
      const durationMs = startTs && lastLineTs ? lastLineTs - startTs : null

      return { i, humanTokens, assistantTokens, toolUses, toolResults, startTs, durationMs }
    })

    // Compute top-quartile threshold for assistant_tokens within this session
    const tokenValues = rawRoundtrips
      .map(r => r.assistantTokens)
      .filter((v): v is number => v !== null)
      .sort((a, b) => a - b)
    const q75 = tokenValues.length > 0
      ? tokenValues[Math.floor(tokenValues.length * 0.75)]
      : null

    let toolCallsWritten = 0

    for (const r of rawRoundtrips) {
      const roundtripId = `${sessionId}-${r.i}`
      let score = 0
      if (r.toolUses.some(t => t.name && WRITE_TOOL_RE.test(t.name))) score++
      if (r.toolUses.length >= 3) score++
      if (q75 !== null && r.assistantTokens !== null && r.assistantTokens >= q75 && tokenValues.length > 1) score++

      upsertRoundtrip(this.db, {
        id: roundtripId,
        session_id: sessionId,
        sequence_nr: r.i + 1,
        human_tokens: r.humanTokens,
        assistant_tokens: r.assistantTokens,
        tool_call_count: r.toolUses.length,
        significance_score: Math.min(score, 3),
        started_at: r.startTs,
        duration_ms: r.durationMs
      })

      for (let j = 0; j < r.toolUses.length; j++) {
        const toolUse = r.toolUses[j]
        const toolResult = r.toolResults[j]
        insertAnalyticsToolCall(this.db, {
          id: randomUUID(),
          roundtrip_id: roundtripId,
          tool_name: toolUse.name ?? 'unknown',
          duration_ms: toolResult?.duration_ms ?? null,
          success: toolResult?.is_error ? 0 : 1
        })
        toolCallsWritten++
      }
    }

    return { sessionId, roundtripsWritten: groups.length, toolCallsWritten, skipped: false }
  }
}
```

Add `IngestResult` to `packages/bridge/src/types.ts`:

```typescript
export interface IngestResult {
  sessionId: string
  roundtripsWritten: number
  toolCallsWritten: number
  skipped: boolean
}
```

- [ ] **Step 4: Run tests**

```powershell
npm test --workspace=packages/bridge -- tests/claude-code-adapter.test.ts
```
Expected: all 3 tests PASS

- [ ] **Step 5: Run full bridge suite**

```powershell
npm test --workspace=packages/bridge
```
Expected: all tests PASS

- [ ] **Step 6: Commit**

```powershell
git add packages/bridge/src/claude-code-adapter.ts packages/bridge/src/types.ts packages/bridge/tests/claude-code-adapter.test.ts
git commit -m "feat: ClaudeCodeAdapter — JSONL transcript → analytics.db (idempotent)"
```

---

### Task 3: `SessionCollector` + Bridge API endpoints

File watcher lifecycle class that activates when the toggle is on. Exposes REST endpoints so the UI can read/write the collector config and trigger manual ingestion.

**Files:**
- Create: `packages/bridge/src/session-collector.ts`
- Modify: `packages/bridge/src/api-routes.ts`
- Modify: `packages/bridge/src/cockpit-server.ts`
- Create: `packages/bridge/tests/session-collector.test.ts`

**Interfaces consumed:**
- `ClaudeCodeAdapter` (Task 2)
- `openAnalyticsDb` (Task 1)

**New REST endpoints (all inside `if (registry)` block in api-routes.ts):**

```
GET  /api/collector/config   → CollectorConfig
PUT  /api/collector/config   → CollectorConfig (body: Partial<CollectorConfig>)
GET  /api/collector/status   → { enabled: boolean; watchedDirs: string[]; lastRunAt: number | null }
POST /api/collector/ingest   → { ingested: number; skipped: number }  (manual trigger)
GET  /api/analytics/sessions → SessionRow[]
GET  /api/analytics/sessions/:id/roundtrips → RoundtripRow[]
GET  /api/analytics/roundtrips/:id/tool-calls → AnalyticsToolCallRow[]
```

**CollectorConfig shape:**
```typescript
export interface CollectorConfig {
  enabled: boolean
  dirs: Array<{ path: string; enabled: boolean; auto: boolean }>
  // auto: true = discovered from default locations; false = manually added
}
```

Default config dirs: scans `~/.claude/projects/` for subdirectories containing `*.jsonl` files.

**SessionCollector class:**
```typescript
export class SessionCollector {
  constructor(analyticsDb: Database.Database, config: CollectorConfig)
  start(): void   // activates fs.watch on enabled dirs
  stop(): void    // stops all watchers
  ingestAll(): Promise<{ ingested: number; skipped: number }>  // manual full pass
  getStatus(): { enabled: boolean; watchedDirs: string[]; lastRunAt: number | null }
}
```

- [ ] **Step 1: Write the failing tests**

Create `packages/bridge/tests/session-collector.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
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
})
```

- [ ] **Step 2: Run to verify failure**

```powershell
npm test --workspace=packages/bridge -- tests/session-collector.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Implement `session-collector.ts`**

Create `packages/bridge/src/session-collector.ts`:

```typescript
import { readdirSync, watch, existsSync } from 'fs'
import { join, extname } from 'path'
import { homedir } from 'os'
import type Database from 'better-sqlite3'
import { ClaudeCodeAdapter } from './claude-code-adapter.js'

export interface CollectorConfig {
  enabled: boolean
  dirs: Array<{ path: string; enabled: boolean; auto: boolean }>
}

export function discoverDefaultDirs(): string[] {
  const base = join(homedir(), '.claude', 'projects')
  if (!existsSync(base)) return []
  try {
    return readdirSync(base, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => join(base, e.name))
  } catch {
    return []
  }
}

export class SessionCollector {
  private watchers: ReturnType<typeof watch>[] = []
  private lastRunAt: number | null = null
  private readonly adapter: ClaudeCodeAdapter

  constructor(
    private readonly db: Database.Database,
    private config: CollectorConfig
  ) {
    this.adapter = new ClaudeCodeAdapter(db)
  }

  start(): void {
    this.stop()
    if (!this.config.enabled) return
    for (const dir of this.config.dirs) {
      if (!dir.enabled || !existsSync(dir.path)) continue
      try {
        const watcher = watch(dir.path, { persistent: false }, (_event, filename) => {
          if (filename && extname(filename) === '.jsonl') {
            const fullPath = join(dir.path, filename)
            this.adapter.ingest(fullPath).catch(() => {})
          }
        })
        this.watchers.push(watcher)
      } catch {
        // dir may disappear — non-fatal
      }
    }
  }

  stop(): void {
    for (const w of this.watchers) {
      try { w.close() } catch { /* already closed */ }
    }
    this.watchers = []
  }

  async ingestAll(): Promise<{ ingested: number; skipped: number }> {
    let ingested = 0
    let skipped = 0
    for (const dir of this.config.dirs) {
      if (!dir.enabled || !existsSync(dir.path)) continue
      let files: string[]
      try {
        files = readdirSync(dir.path).filter(f => extname(f) === '.jsonl').map(f => join(dir.path, f))
      } catch {
        continue
      }
      for (const file of files) {
        try {
          const result = await this.adapter.ingest(file)
          if (result.skipped) skipped++
          else ingested++
        } catch {
          // per-file errors non-fatal
        }
      }
    }
    this.lastRunAt = Date.now()
    return { ingested, skipped }
  }

  updateConfig(config: CollectorConfig): void {
    this.config = config
    if (config.enabled) {
      this.start()
    } else {
      this.stop()
    }
  }

  getStatus(): { enabled: boolean; watchedDirs: string[]; lastRunAt: number | null } {
    return {
      enabled: this.config.enabled,
      watchedDirs: this.config.dirs.filter(d => d.enabled).map(d => d.path),
      lastRunAt: this.lastRunAt
    }
  }

  getConfig(): CollectorConfig {
    return this.config
  }
}
```

- [ ] **Step 4: Add REST endpoints to `api-routes.ts`**

At the top of `packages/bridge/src/api-routes.ts`, add imports:

```typescript
import { openAnalyticsDb, listSessions, listRoundtrips, listAnalyticsToolCalls } from './analytics-db.js'
import { SessionCollector, discoverDefaultDirs } from './session-collector.js'
import type { CollectorConfig } from './session-collector.js'
```

Inside `registerApiRoutes`, add a `collector` parameter and initialize inside the `if (registry)` block. Update the function signature:

```typescript
export async function registerApiRoutes(
  fastify: FastifyInstance,
  db: Database.Database,
  eventBus: EventBus,
  registryOrServerId: ActiveRegistry | string,
  cliBin?: string,
  collector?: SessionCollector
): Promise<void>
```

Inside the `if (registry)` block, after the existing routes, add:

```typescript
    // --- Analytics API ---
    const analyticsDb = openAnalyticsDb()

    fastify.get('/api/analytics/sessions', async () => listSessions(analyticsDb))

    fastify.get<{ Params: { id: string } }>('/api/analytics/sessions/:id/roundtrips', async (req) =>
      listRoundtrips(analyticsDb, req.params.id)
    )

    fastify.get<{ Params: { id: string } }>('/api/analytics/roundtrips/:id/tool-calls', async (req) =>
      listAnalyticsToolCalls(analyticsDb, req.params.id)
    )

    // --- Collector API ---
    fastify.get('/api/collector/status', async () =>
      collector ? collector.getStatus() : { enabled: false, watchedDirs: [], lastRunAt: null }
    )

    fastify.get('/api/collector/config', async () =>
      collector ? collector.getConfig() : { enabled: false, dirs: [] }
    )

    fastify.put<{ Body: Partial<CollectorConfig> }>('/api/collector/config', async (req) => {
      if (!collector) return { enabled: false, dirs: [] }
      const current = collector.getConfig()
      const next: CollectorConfig = { ...current, ...req.body }
      collector.updateConfig(next)
      return collector.getConfig()
    })

    fastify.post('/api/collector/ingest', async () =>
      collector ? collector.ingestAll() : { ingested: 0, skipped: 0 }
    )
```

- [ ] **Step 5: Wire `SessionCollector` into `CockpitServer`**

In `packages/bridge/src/cockpit-server.ts`, add:

```typescript
import { openAnalyticsDb } from './analytics-db.js'
import { SessionCollector, discoverDefaultDirs } from './session-collector.js'
import type { CollectorConfig } from './session-collector.js'
```

In the `CockpitServer` class, add a field and initialize in `start()`:

```typescript
private collector: SessionCollector | undefined

async start(): Promise<void> {
  if (this.started) return

  const analyticsDb = openAnalyticsDb()
  const defaultDirs = discoverDefaultDirs()
  const initConfig: CollectorConfig = {
    enabled: false,
    dirs: defaultDirs.map(p => ({ path: p, enabled: true, auto: true }))
  }
  this.collector = new SessionCollector(analyticsDb, initConfig)

  // ... existing static files + registerApiRoutes call, updated:
  await registerApiRoutes(this.fastify, this.db, this.eventBus, this.registry, this.options.cliBin, this.collector)
  // ... rest of existing start() body unchanged
}

async stop(): Promise<void> {
  if (this.started) {
    this.collector?.stop()
    await this.fastify.close()
    this.started = false
  }
}
```

- [ ] **Step 6: Run all tests**

```powershell
npm test --workspace=packages/bridge
```
Expected: all tests PASS (including new session-collector tests)

- [ ] **Step 7: Commit**

```powershell
git add packages/bridge/src/session-collector.ts packages/bridge/src/api-routes.ts packages/bridge/src/cockpit-server.ts packages/bridge/tests/session-collector.test.ts
git commit -m "feat: SessionCollector + analytics/collector REST endpoints"
```

---

### Task 4: UI — Live Monitor Panel

New panel that shows real-time MCP tool executions using the existing SSE event stream. Replaces or supplements the existing Call Log with a live roundtrip-focused view.

**Files:**
- Create: `packages/ui/src/panels/monitor/index.tsx`
- Modify: `packages/ui/src/registry.ts`
- Modify: `packages/ui/src/api/client.ts`
- Create: `packages/ui/src/tests/monitor.test.tsx`

**Interfaces consumed from `client.ts` (already exist):**
- `subscribeEvents` — SSE listener
- `ToolCall` type

**New type in `client.ts`:**
```typescript
export interface LiveRoundtrip {
  id: string           // generated client-side: timestamp string
  startedAt: number
  toolCalls: ToolCall[]
  active: boolean
}
```

The panel maintains a list of `LiveRoundtrip` objects in component state, updated via SSE `tool_call` events. A new roundtrip starts when more than 2 seconds pass since the last tool call.

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/tests/monitor.test.tsx`:

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { MonitorPanel } from '../panels/monitor/index.js'

vi.mock('../api/client.js', () => ({
  subscribeEvents: vi.fn(() => () => {}),
}))

describe('MonitorPanel', () => {
  afterEach(() => vi.clearAllMocks())

  it('renders empty state when no events received', () => {
    render(<MonitorPanel />)
    expect(screen.getByText(/no active tool calls/i)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to verify failure**

```powershell
npm test --workspace=packages/ui -- src/tests/monitor.test.tsx
```
Expected: FAIL — module not found

- [ ] **Step 3: Implement `monitor/index.tsx`**

Create `packages/ui/src/panels/monitor/index.tsx`:

```typescript
import { useEffect, useRef, useState } from 'react'
import { subscribeEvents } from '../../api/client.js'
import type { Panel } from '../../registry.js'

interface LiveToolCall {
  tool_name: string
  server_id: string
  duration_ms: number
  success: boolean
  ts: number
}

interface LiveRoundtrip {
  id: string
  startedAt: number
  toolCalls: LiveToolCall[]
  active: boolean
}

const ROUNDTRIP_GAP_MS = 2000

export function MonitorPanel() {
  const [roundtrips, setRoundtrips] = useState<LiveRoundtrip[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const lastTsRef = useRef<number>(0)

  useEffect(() => {
    return subscribeEvents((event) => {
      const e = event as { type: string; data?: LiveToolCall }
      if (e.type !== 'tool_call' || !e.data) return
      const now = Date.now()

      setRoundtrips(prev => {
        const gap = now - lastTsRef.current
        lastTsRef.current = now
        const last = prev[prev.length - 1]

        if (!last || !last.active || gap > ROUNDTRIP_GAP_MS) {
          const newRt: LiveRoundtrip = {
            id: String(now),
            startedAt: now,
            toolCalls: [e.data!],
            active: true
          }
          const updated = prev.map(r => ({ ...r, active: false }))
          return [...updated, newRt]
        }

        return prev.map(r =>
          r.id === last.id
            ? { ...r, toolCalls: [...r.toolCalls, e.data!] }
            : r
        )
      })
    })
  }, [])

  const displayRoundtrips = [...roundtrips].reverse()
  const selectedRt = selected
    ? roundtrips.find(r => r.id === selected)
    : roundtrips[roundtrips.length - 1]

  if (roundtrips.length === 0) {
    return (
      <div style={{ padding: '2rem', color: 'var(--color-text-secondary, #888)' }}>
        No active tool calls — tool executions appear here in real time.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', gap: '1rem', height: '100%' }}>
      <div style={{ width: '240px', overflowY: 'auto', borderRight: '1px solid var(--color-border, #333)' }}>
        {displayRoundtrips.map(rt => (
          <div
            key={rt.id}
            onClick={() => setSelected(rt.id)}
            style={{
              padding: '0.5rem 1rem',
              cursor: 'pointer',
              background: selectedRt?.id === rt.id ? 'var(--color-selected, #1e3a5f)' : 'transparent',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}
          >
            <span>{rt.toolCalls.length} calls</span>
            {rt.active && (
              <span style={{ fontSize: '0.7rem', color: 'var(--color-accent, #4a9eff)' }}>● LIVE</span>
            )}
          </div>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem' }}>
        {selectedRt ? (
          <div>
            {selectedRt.toolCalls.map((tc, i) => (
              <div key={i} style={{
                padding: '0.4rem 0.8rem',
                marginBottom: '0.25rem',
                borderLeft: `3px solid ${tc.success ? 'var(--color-success, #4caf50)' : 'var(--color-error, #f44336)'}`,
                background: 'var(--color-surface, #1a1a1a)'
              }}>
                <span style={{ fontWeight: 600 }}>{tc.tool_name}</span>
                <span style={{ marginLeft: '1rem', color: 'var(--color-text-secondary, #888)', fontSize: '0.85rem' }}>
                  {tc.server_id} · {tc.duration_ms}ms
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export const panel: Panel = {
  id: 'monitor',
  label: 'Live Monitor',
  route: '/monitor',
  component: MonitorPanel,
  order: 15
}
```

- [ ] **Step 4: Register the panel**

In `packages/ui/src/registry.ts`, add:

```typescript
import { panel as monitor } from './panels/monitor/index.js'
export const panels: Panel[] = [servers, calls, tokens, monitor]
  .sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
```

- [ ] **Step 5: Run tests**

```powershell
npm test --workspace=packages/ui -- src/tests/monitor.test.tsx
```
Expected: PASS

- [ ] **Step 6: Run full UI suite**

```powershell
npm test --workspace=packages/ui
```
Expected: all tests PASS

- [ ] **Step 7: Commit**

```powershell
git add packages/ui/src/panels/monitor/index.tsx packages/ui/src/registry.ts packages/ui/src/tests/monitor.test.tsx
git commit -m "feat: Live Monitor panel — real-time MCP tool call view via SSE"
```

---

### Task 5: UI — Session Analytics Panel + Collector Toggle

Session timeline visualization and the collector toggle with directory config card in the shell header.

**Files:**
- Create: `packages/ui/src/panels/analytics/index.tsx`
- Create: `packages/ui/src/shell/Shell.tsx`
- Modify: `packages/ui/src/api/client.ts`
- Modify: `packages/ui/src/registry.ts`
- Modify: `packages/ui/src/main.tsx`
- Create: `packages/ui/src/tests/analytics.test.tsx`

**New functions in `client.ts`:**

```typescript
export const getSessions    = () => get<SessionRow[]>('/api/analytics/sessions')
export const getRoundtrips  = (id: string) => get<RoundtripRow[]>(`/api/analytics/sessions/${encodeURIComponent(id)}/roundtrips`)
export const getCollectorStatus = () => get<{ enabled: boolean; watchedDirs: string[]; lastRunAt: number | null }>('/api/collector/status')
export const getCollectorConfig = () => get<CollectorConfig>('/api/collector/config')
export const putCollectorConfig = (config: Partial<CollectorConfig>) =>
  fetch('/api/collector/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) }).then(r => r.json())
export const postCollectorIngest = () =>
  fetch('/api/collector/ingest', { method: 'POST' }).then(r => r.json())
```

**Types to add to `client.ts`:**
```typescript
export interface SessionRow { id: string; provider: string; source_path: string; file_hash: string; started_at: number | null; ended_at: number | null }
export interface RoundtripRow { id: string; session_id: string; sequence_nr: number; human_tokens: number | null; assistant_tokens: number | null; tool_call_count: number; significance_score: number; started_at: number | null; duration_ms: number | null }
export interface CollectorConfig { enabled: boolean; dirs: Array<{ path: string; enabled: boolean; auto: boolean }> }
```

**Significance color mapping:**
```typescript
const SIGNIFICANCE_COLORS: Record<number, string> = {
  0: 'var(--color-text-secondary, #666)',
  1: 'var(--color-info, #4a9eff)',
  2: 'var(--color-warning, #ff9800)',
  3: 'var(--color-success, #4caf50)',
}
```

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/tests/analytics.test.tsx`:

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AnalyticsPanel } from '../panels/analytics/index.js'

vi.mock('../api/client.js', () => ({
  getSessions: vi.fn().mockResolvedValue([]),
  getRoundtrips: vi.fn().mockResolvedValue([]),
}))

describe('AnalyticsPanel', () => {
  afterEach(() => vi.clearAllMocks())

  it('renders empty state when no sessions', async () => {
    render(<AnalyticsPanel />)
    // Empty state appears after async load
    await screen.findByText(/no sessions collected yet/i)
  })
})
```

- [ ] **Step 2: Run to verify failure**

```powershell
npm test --workspace=packages/ui -- src/tests/analytics.test.tsx
```
Expected: FAIL — module not found

- [ ] **Step 3: Add API functions to `client.ts`**

Append to `packages/ui/src/api/client.ts`:

```typescript
export interface SessionRow {
  id: string; provider: string; source_path: string; file_hash: string
  started_at: number | null; ended_at: number | null
}
export interface RoundtripRow {
  id: string; session_id: string; sequence_nr: number
  human_tokens: number | null; assistant_tokens: number | null
  tool_call_count: number; significance_score: number
  started_at: number | null; duration_ms: number | null
}
export interface CollectorConfig {
  enabled: boolean
  dirs: Array<{ path: string; enabled: boolean; auto: boolean }>
}

export const getSessions       = () => get<SessionRow[]>('/api/analytics/sessions')
export const getRoundtrips     = (id: string) => get<RoundtripRow[]>(`/api/analytics/sessions/${encodeURIComponent(id)}/roundtrips`)
export const getCollectorStatus = () => get<{ enabled: boolean; watchedDirs: string[]; lastRunAt: number | null }>('/api/collector/status')
export const getCollectorConfig = () => get<CollectorConfig>('/api/collector/config')
export const putCollectorConfig = (config: Partial<CollectorConfig>): Promise<CollectorConfig> =>
  fetch('/api/collector/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) }).then(r => r.json())
export const postCollectorIngest = (): Promise<{ ingested: number; skipped: number }> =>
  fetch('/api/collector/ingest', { method: 'POST' }).then(r => r.json())
```

- [ ] **Step 4: Implement `analytics/index.tsx`**

Create `packages/ui/src/panels/analytics/index.tsx`:

```typescript
import { useEffect, useState } from 'react'
import { getSessions, getRoundtrips } from '../../api/client.js'
import type { SessionRow, RoundtripRow } from '../../api/client.js'
import type { Panel } from '../../registry.js'

const SIGNIFICANCE_COLORS: Record<number, string> = {
  0: 'var(--color-text-secondary, #555)',
  1: '#4a9eff',
  2: '#ff9800',
  3: '#4caf50',
}

export function AnalyticsPanel() {
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [selectedSession, setSelectedSession] = useState<string | null>(null)
  const [roundtrips, setRoundtrips] = useState<RoundtripRow[]>([])
  const [selectedRt, setSelectedRt] = useState<RoundtripRow | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getSessions().then(s => {
      setSessions(s)
      if (s.length > 0) setSelectedSession(s[0].id)
    }).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!selectedSession) return
    getRoundtrips(selectedSession).then(setRoundtrips)
    setSelectedRt(null)
  }, [selectedSession])

  const maxTokens = Math.max(...roundtrips.map(r => (r.human_tokens ?? 0) + (r.assistant_tokens ?? 0)), 1)

  if (loading) return <div style={{ padding: '2rem' }}>Loading…</div>

  if (sessions.length === 0) {
    return (
      <div style={{ padding: '2rem', color: 'var(--color-text-secondary, #888)' }}>
        No sessions collected yet. Enable Auto Session Collector in the header to start.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '1rem', gap: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <label style={{ fontWeight: 600 }}>Session</label>
        <select
          value={selectedSession ?? ''}
          onChange={e => setSelectedSession(e.target.value)}
          style={{ padding: '0.3rem 0.5rem', background: 'var(--color-surface, #1a1a1a)', color: 'inherit', border: '1px solid var(--color-border, #333)', borderRadius: '4px' }}
        >
          {sessions.map(s => (
            <option key={s.id} value={s.id}>
              {s.source_path.split('/').slice(-2).join('/')} · {s.started_at ? new Date(s.started_at).toLocaleDateString() : '?'}
            </option>
          ))}
        </select>
      </div>

      <div style={{ display: 'flex', gap: '1rem', flex: 1, overflow: 'hidden' }}>
        {/* Timeline */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {roundtrips.map(rt => {
            const tokens = (rt.human_tokens ?? 0) + (rt.assistant_tokens ?? 0)
            const widthPct = Math.max(4, Math.round((tokens / maxTokens) * 100))
            const color = SIGNIFICANCE_COLORS[rt.significance_score] ?? SIGNIFICANCE_COLORS[0]
            return (
              <div
                key={rt.id}
                onClick={() => setSelectedRt(rt)}
                style={{ marginBottom: '0.35rem', cursor: 'pointer' }}
              >
                <div style={{
                  width: `${widthPct}%`,
                  height: '28px',
                  background: color,
                  borderRadius: '3px',
                  display: 'flex',
                  alignItems: 'center',
                  paddingLeft: '0.5rem',
                  fontSize: '0.8rem',
                  color: '#fff',
                  opacity: selectedRt?.id === rt.id ? 1 : 0.75,
                  outline: selectedRt?.id === rt.id ? `2px solid ${color}` : 'none',
                }}>
                  #{rt.sequence_nr} · {rt.tool_call_count > 0 ? `${rt.tool_call_count} tools` : `${tokens} tok`}
                </div>
              </div>
            )
          })}
        </div>

        {/* Detail drawer */}
        {selectedRt && (
          <div style={{ width: '320px', background: 'var(--color-surface, #1a1a1a)', borderRadius: '6px', padding: '1rem', overflowY: 'auto' }}>
            <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Roundtrip #{selectedRt.sequence_nr}</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary, #888)', marginBottom: '0.75rem' }}>
              {selectedRt.human_tokens ?? 0} human · {selectedRt.assistant_tokens ?? 0} assistant tokens
              {selectedRt.duration_ms ? ` · ${(selectedRt.duration_ms / 1000).toFixed(1)}s` : ''}
            </div>
            <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.25rem' }}>
              Significance: {['Routine', 'Active', 'Relevant', 'Key moment'][selectedRt.significance_score]}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export const panel: Panel = {
  id: 'analytics',
  label: 'Session Analytics',
  route: '/analytics',
  component: AnalyticsPanel,
  order: 20
}
```

- [ ] **Step 5: Implement `Shell.tsx` with collector toggle**

Create `packages/ui/src/shell/Shell.tsx`:

```typescript
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
    const next = { ...config, enabled: !config.enabled }
    const updated = await putCollectorConfig(next)
    setConfig(updated)
  }

  const toggleDir = async (path: string) => {
    if (!config) return
    const next = {
      ...config,
      dirs: config.dirs.map(d => d.path === path ? { ...d, enabled: !d.enabled } : d)
    }
    const updated = await putCollectorConfig(next)
    setConfig(updated)
  }

  const handleIngest = async () => {
    setIngesting(true)
    try { await postCollectorIngest() } finally { setIngesting(false) }
  }

  if (!config) return null

  return (
    <div style={{ fontSize: '0.85rem' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
        <input type="checkbox" checked={config.enabled} onChange={toggle} />
        Auto Session Collector
      </label>

      {config.enabled && config.dirs.length > 0 && (
        <div style={{ marginTop: '0.5rem', paddingLeft: '0.5rem', borderLeft: '2px solid var(--color-border, #333)' }}>
          <div style={{ fontWeight: 600, marginBottom: '0.25rem', color: 'var(--color-text-secondary, #888)' }}>
            Transcript directories:
          </div>
          {config.dirs.map(d => (
            <label key={d.path} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', marginBottom: '0.2rem' }}>
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
```

- [ ] **Step 6: Register analytics panel**

In `packages/ui/src/registry.ts`, add the analytics panel:

```typescript
import { panel as monitor }    from './panels/monitor/index.js'
import { panel as analytics }  from './panels/analytics/index.js'

export const panels: Panel[] = [servers, calls, tokens, monitor, analytics]
  .sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
```

- [ ] **Step 7: Run tests**

```powershell
npm test --workspace=packages/ui -- src/tests/analytics.test.tsx
```
Expected: PASS

- [ ] **Step 8: Run full UI suite**

```powershell
npm test --workspace=packages/ui
```
Expected: all tests PASS

- [ ] **Step 9: Commit**

```powershell
git add packages/ui/src/panels/analytics/index.tsx packages/ui/src/shell/Shell.tsx packages/ui/src/api/client.ts packages/ui/src/registry.ts packages/ui/src/tests/analytics.test.tsx
git commit -m "feat: Session Analytics panel + collector toggle UI"
```

---

## Self-Review

**Spec coverage:**
- ✅ `analytics.db` separate from `bridge.db` — Task 1
- ✅ `ClaudeCodeAdapter` with JSONL parsing + significance scoring — Task 2
- ✅ Idempotency (SHA-256 file hash skip) — Task 2
- ✅ `SessionCollector` file watcher lifecycle — Task 3
- ✅ Toggle = off default (CockpitServer init with `enabled: false`) — Task 3
- ✅ Dir discovery from `~/.claude/projects/` — Task 3 (`discoverDefaultDirs`)
- ✅ Collector REST endpoints (config GET/PUT, ingest POST, status GET) — Task 3
- ✅ Analytics REST endpoints (sessions, roundtrips, tool-calls) — Task 3
- ✅ Live Monitor panel — Task 4
- ✅ Session Analytics panel with timeline + significance colors — Task 5
- ✅ Collector toggle + directory config card — Task 5
- ✅ Empty states for both panels — Tasks 4, 5

**Placeholder scan:** None found.

**Type consistency:**
- `CollectorConfig` defined in `session-collector.ts`, imported in `api-routes.ts` and `client.ts` — consistent
- `SessionRow`, `RoundtripRow` defined in `analytics-db.ts`, mirrored in `client.ts` — field names match exactly
- `IngestResult` added to `types.ts`, exported from `claude-code-adapter.ts` — consistent
