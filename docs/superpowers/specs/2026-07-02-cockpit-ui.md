# mcpinv Cockpit UI — Design Spec

**Version:** 0.1  
**Date:** 2026-07-02  
**Status:** Draft

---

## Goal

A local web UI (`http://localhost:3001`) that gives developers real-time visibility
into their MCP servers — tool calls, token usage, errors — without any additional
install step beyond `mcpinv serve`. Architecturally open: adding a new panel in a
future version requires one file and one import, nothing else.

---

## Non-Goals

- No cloud sync, no accounts, no telemetry in v1
- No native desktop shell (Tauri/Electron deferred until Enterprise demand confirmed)
- No multi-machine support in v1

---

## Package Layout

```
packages/
  bridge/          existing — extended with event emitter + SQLite writer
  cli/             existing — serve command opens browser on start
  ui/              new — React + Vite SPA served by Bridge on :3001
    src/
      shell/       layout, navigation, panel slot system
      panels/      one subdirectory per feature panel
      registry.ts  panel registration — single source of truth for nav
      api/         typed HTTP + SSE client
      db/          query helpers (read-only; writes happen in bridge)
```

The Bridge serves the compiled UI as static files and exposes the data API.
There is no separate UI server process.

---

## Panel Registry

Every panel is a self-contained module that exports one `Panel` object.

```typescript
// packages/ui/src/registry.ts

export interface Panel {
  id: string                        // unique, used as route segment
  label: string                     // nav label
  icon: string                      // lucide icon name
  route: string                     // e.g. '/tokens'
  component: React.ComponentType
  badge?: () => number | null       // live nav badge (error count, etc.)
  tier?: 'free' | 'pro'            // 'pro' panels render a lock state
  order?: number                    // nav sort order, default 100
}

// All panels imported here — adding a panel = one line
import { panel as servers }  from './panels/servers'
import { panel as calls }    from './panels/calls'
import { panel as tokens }   from './panels/tokens'

export const panels: Panel[] = [servers, calls, tokens]
```

The Shell iterates `panels`, renders navigation, and mounts the active panel
component via React Router. It has no knowledge of panel internals.

---

## v1 Panels

### 1. Servers (`/servers`)

**What it shows:**
- All configured MCP servers (from Claude/Cursor config)
- Status per server: running / stopped / error
- Uptime, restart count, last error message
- Quick actions: start / stop / restart / open diagnose

**Data source:** REST `GET /api/servers`

---

### 2. Call Log (`/calls`)

**What it shows:**
- Live stream of tool calls across all servers
- Columns: timestamp, server, tool name, duration (ms), status (ok / error), token cost
- Click a row → expand: full args (pretty-printed JSON), response preview, raw stderr on error
- Filter by server, tool name, status
- Pause / resume live stream toggle

**Data source:** SSE `GET /api/events` filtered to `tool_call` events  
**History:** REST `GET /api/calls?limit=200&server=x&status=error`

---

### 3. Token Usage (`/tokens`)

**What it shows:**
- Bar chart: tokens per day (last 14 days), stacked by server
- Top-5 tools by token consumption (all-time)
- Single most expensive call (with link to call log entry)
- Today's running total with estimated cost (configurable rate per 1k tokens)

**Data source:** REST `GET /api/tokens/summary` + `GET /api/tokens/daily?days=14`

**Wow moment:** first time a developer sees "that one `search_code` call at 14:32
consumed 47k tokens — 80% of today's total."

---

## Data Layer

### SQLite Schema (`~/.mcpinv/cockpit.db`)

```sql
-- Written by Bridge on every tool call
CREATE TABLE tool_calls (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ts           INTEGER NOT NULL,          -- unix ms
  server_id    TEXT    NOT NULL,
  tool_name    TEXT    NOT NULL,
  args_hash    TEXT    NOT NULL,          -- sha256(args), no PII stored
  duration_ms  INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  success      INTEGER NOT NULL,          -- 0 | 1
  error_msg    TEXT                       -- null on success
);

CREATE INDEX idx_tc_ts        ON tool_calls(ts);
CREATE INDEX idx_tc_server    ON tool_calls(server_id);
CREATE INDEX idx_tc_tool      ON tool_calls(tool_name);

-- Schema version for forward-compatible migrations
CREATE TABLE schema_version (
  version INTEGER NOT NULL
);
INSERT INTO schema_version VALUES (1);
```

**Rules:**
- Bridge writes, UI reads only — no UI writes to SQLite
- Migrations are additive: new columns use `ALTER TABLE ADD COLUMN` with a default
- No raw args/response stored — only the hash (privacy by default)

---

## Bridge Extensions

### New REST Endpoints (added to existing Fastify server)

```
GET  /api/servers                     → ServerStatus[]
GET  /api/calls?limit&server&status   → ToolCall[]
GET  /api/tokens/summary              → TokenSummary
GET  /api/tokens/daily?days=14        → DailyBucket[]
GET  /api/events                      → SSE stream (see below)
GET  /                                → serves UI static files
```

### SSE Event Format

```typescript
// GET /api/events  (text/event-stream)

type CockpitEvent =
  | { type: 'tool_call';    data: ToolCallEvent }
  | { type: 'server_up';    data: ServerEvent   }
  | { type: 'server_down';  data: ServerEvent   }
  | { type: 'server_error'; data: ServerEvent   }

interface ToolCallEvent {
  id:            number
  ts:            number
  server_id:     string
  tool_name:     string
  duration_ms:   number
  input_tokens:  number | null
  output_tokens: number | null
  success:       boolean
  error_msg:     string | null
}

interface ServerEvent {
  ts:        number
  server_id: string
  message?:  string
}
```

Every Bridge `callTool()` emit fires a `tool_call` event on the SSE bus.
Clients reconnect automatically on disconnect (EventSource native behavior).

---

## UI Tech Stack

| Concern | Choice | Reason |
|---|---|---|
| Framework | React 18 | Ecosystem, team familiarity |
| Build | Vite + ESM | Fast HMR, fits existing TS stack |
| Routing | React Router v6 | Panel-per-route maps cleanly |
| Styling | Tailwind CSS | Utility-first, no CSS conflicts between panels |
| Charts | Recharts | Lightweight, composable, no canvas |
| Icons | lucide-react | Tree-shakeable, consistent |
| SSE client | native EventSource | No extra dependency |
| HTTP client | native fetch | No extra dependency |

---

## Extension Points for Future Versions

### Adding a v2 Panel

1. Create `packages/ui/src/panels/alerts/index.tsx` exporting a `Panel`
2. Add one import line to `registry.ts`
3. Done — shell picks it up, nav entry appears

No changes to shell, routing config, or Bridge.

### Adding a new metric

1. `ALTER TABLE tool_calls ADD COLUMN new_metric INTEGER` (migration)
2. Bridge writes the new column
3. New panel or extended existing panel reads it via new REST endpoint

### Paid-tier gating

```typescript
// panel definition
export const panel: Panel = {
  id: 'alerts',
  tier: 'pro',
  // ...
}

// Shell renders lock state automatically for tier === 'pro' + no license
```

License check is local (signed JWT in `~/.mcpinv/license`). No online check on
every render — check once on app load, cache for session.

### Tauri shell (future)

If native distribution becomes necessary:
- Tauri wraps the existing `localhost:3001` UI in a WebView — zero UI changes
- Bridge starts as a sidecar process managed by Tauri
- Tray icon calls `mcpinv serve` under the hood

The web-first architecture ensures the Tauri shell is purely a distribution
wrapper, not a rebuild.

---

## v1 Scope (Implementation Plan Input)

**In scope:**
- `packages/ui` with Shell + 3 panels (Servers, Call Log, Token Usage)
- SQLite schema v1 + Bridge writes on every `callTool()`
- SSE bus in Bridge
- 5 new REST endpoints
- `mcpinv serve` opens browser automatically (`open` package)
- UI built + bundled into Bridge static dir at `npm run build`

**Out of scope for v1:**
- Tool allowlist/blocklist panel
- Anomaly detection / alerts
- Paid-tier gating (structure ready, not activated)
- Tauri shell
- Token cost estimation (UI shows raw counts; rate config is v2)
