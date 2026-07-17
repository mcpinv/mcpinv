# Analytics Panel — Design Spec

**Date:** 2026-07-17
**Status:** Approved

## Overview

Two new subsystems added to mcpinv Cockpit:

1. **Session Collector** — opt-in file watcher + adapter pipeline → `analytics.db`
2. **Analytics Panel** — two tabs in the Cockpit UI: *Live Monitor* and *Session Analytics*

The Live Monitor uses existing real-time SSE infrastructure (no tokens, MCP tool calls only). Session Analytics is post-hoc, reading Claude Code JSONL transcripts via a provider adapter and storing results in a separate SQLite database.

---

## Session Collector

### Trigger

Toggle **"Auto Session Collector"** in the Cockpit header (default: **off**).

When toggled on, a config card appears below the toggle:

```
Auto Session Collector: [on]

Transcript directories found:
  [x] ~/.claude/projects/project-a/
  [x] ~/.claude/projects/project-b/
  [ ] ~/.claude/projects/project-c/   ← user unchecked
  [+ Add path]
```

All discovered directories are checked by default. The user can uncheck individual directories or add custom paths manually. Discovery scans only known default locations (`~/.claude/projects/*/`); it does not recurse arbitrarily.

### Architecture

The file watcher runs inside the Cockpit bridge process. When Cockpit exits, the watcher stops. No separate daemon.

```
JSONL file watcher (chokidar or fs.watch)
  → changed/new file detected
  → ClaudeCodeAdapter.ingest(filePath)
  → canonical records written to analytics.db
```

Only `ClaudeCodeAdapter` is implemented in v1. The adapter interface is defined so future adapters (`ChatGPTAdapter`, etc.) can be added without touching the pipeline.

### Idempotency

Each source file is identified by its SHA-256 hash stored in `analytics.db`. If the hash matches an already-ingested record, the file is skipped. Re-ingesting a modified file (hash changed) replaces the prior records for that source path.

### Adapter Interface

```typescript
interface SessionAdapter {
  readonly provider: string  // e.g. 'claude-code'
  ingest(filePath: string): Promise<IngestResult>
}

interface IngestResult {
  sessionId: string
  roundtripsWritten: number
  toolCallsWritten: number
  skipped: boolean  // true if hash unchanged
}
```

---

## Canonical Schema (`analytics.db`)

### Tables

```sql
CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,  -- SHA-256 of source_path + started_at
  provider     TEXT NOT NULL,     -- 'claude-code' | 'chatgpt' | ...
  source_path  TEXT NOT NULL,
  file_hash    TEXT NOT NULL,     -- SHA-256 of file contents; skip if unchanged
  started_at   INTEGER,           -- ms since epoch
  ended_at     INTEGER
);

CREATE TABLE roundtrips (
  id                TEXT PRIMARY KEY,
  session_id        TEXT NOT NULL REFERENCES sessions(id),
  sequence_nr       INTEGER NOT NULL,  -- 1-based position in session
  human_tokens      INTEGER,
  assistant_tokens  INTEGER,
  tool_call_count   INTEGER NOT NULL DEFAULT 0,
  significance_score INTEGER NOT NULL DEFAULT 0,  -- 0–3, see scoring rules
  started_at        INTEGER,
  duration_ms       INTEGER
);

CREATE TABLE analytics_tool_calls (
  id           TEXT PRIMARY KEY,
  roundtrip_id TEXT NOT NULL REFERENCES roundtrips(id),
  tool_name    TEXT NOT NULL,
  duration_ms  INTEGER,
  success      INTEGER NOT NULL DEFAULT 1  -- 1=ok, 0=error
);
```

### Significance Scoring

`significance_score` is computed from transcript metadata during ingest. No LLM call required.

| Condition | Points |
|---|---|
| Any tool call writes/edits a file or runs a commit | +1 |
| `tool_call_count >= 3` | +1 |
| `assistant_tokens` in top quartile of the session | +1 |

Score range: 0–3.

| Score | Meaning | Color |
|---|---|---|
| 0 | Routine | Grey |
| 1 | Active | Blue |
| 2 | Relevant | Orange |
| 3 | Key moment | Green |

---

## Live Monitor Panel

Uses the existing SSE event stream (`GET /api/events`). No changes to the backend.

**Layout:**
- Left column: scrolling list of active roundtrips, newest at top. Each entry shows: tool name, duration, server ID.
- Right column: detail view of the selected roundtrip — animated tool-call timeline showing steps as they arrive via SSE.
- Default: newest roundtrip auto-selected and live-updated.
- Click on any earlier roundtrip: detail view freezes on that entry; a "Live" badge on the newest entry signals that it is still updating.

Token counts are not shown in Live Monitor (mcpinv only observes MCP tool executions, not the LLM layer).

---

## Session Analytics Panel

### Main View — Session Timeline

Vertical timeline of a selected session. Each roundtrip is rendered as a horizontal block:

- **Width:** proportional to total tokens (human + assistant) for the roundtrip
- **Color:** `significance_score` → grey / blue / orange / green
- **Label:** sequence number + top tool name (if any)

Clicking a block opens a **detail drawer** (slide-in panel on the right):
- Human message text (truncated to ~300 chars with expand)
- Assistant response summary (truncated to ~300 chars)
- All tool calls in order: name, duration, success/error
- Token breakdown: human / assistant / total

### Session Selector

Dropdown at the top of the panel: lists all ingested sessions, sorted by `started_at` descending. Shows provider badge + source path basename + date.

### Session Comparison

"Compare" button opens a split view: two sessions side by side, timelines vertically synchronized (same time scale). Significance colors remain the same across both. Useful for comparing two runs of the same task.

### Empty State

When no sessions have been ingested yet, the panel shows:

```
No sessions collected yet.
Enable Auto Session Collector in the header to start.
```

---

## Storage

| File | Purpose |
|---|---|
| `~/.mcpinv/bridge.db` | Existing: tool_calls, known_servers, schema_version |
| `~/.mcpinv/analytics.db` | New: sessions, roundtrips, analytics_tool_calls |

The two databases are never joined. The Analytics Panel reads only from `analytics.db`. The Live Monitor reads only from the SSE stream.

---

## Out of Scope (v1)

- Token cost calculation (requires model pricing table)
- Export to CSV/JSON
- Adapters for providers other than Claude Code
- Manual significance tagging by the user
- Search/filter within a session timeline
