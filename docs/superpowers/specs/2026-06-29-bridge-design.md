# mcpinv Bridge — Design Spec

> **Status:** v1.0, 2026-06-29  
> **Scope:** `packages/bridge` — local MCP-to-REST bridge sidecar with hot-swap, error analyzer, and AI-guided diagnosis assistant

---

## 1. Architecture & Components

`mcpinv serve <server-id>` starts two parallel processes:

```
mcpinv serve github
        │
        ▼
  BridgeServer (packages/bridge)
        │
        ├─► MCP subprocess (stdio)
        │     └─ config + secrets from config-manager / OS Keychain
        │     └─ secrets → process.env (industry standard, acceptable locally)
        │
        ├─► MCP Client (@modelcontextprotocol/sdk)
        │     └─ tools/list → tool definitions
        │     └─ tool calls → results
        │
        ├─► Fastify HTTP server
        │     ├─ GET  /openapi.json       → OpenAPI 3.1 spec (reactive)
        │     ├─ GET  /tools              → tool list
        │     └─ POST /tools/<name>       → tool call → MCP → JSON
        │
        └─► ConfigWatcher (fs.watch)
              └─ config change → tools/list → regenerate spec (hot-swap)
```

**Package structure:**
```
packages/bridge/
  src/
    server.ts           — Fastify server, routing
    mcp-client.ts       — @modelcontextprotocol/sdk wrapper
    openapi.ts          — OpenAPI generation from tool definitions
    config-watcher.ts   — fs.watch + hot-swap logic
    diagnose/
      collector.ts      — local context collector
      analyzer.ts       — local pattern matching (Tier 1)
      error-db.ts       — errors.mcpinv.dev lookup + report
      assistant.ts      — streaming dialog with Claude
  bin/
    bridge.js           — entry point
```

**Secret handling:** Secrets are loaded from the OS Keychain via `keytar` and passed as environment variables to the MCP subprocess. No plaintext in config files.

---

## 2. OpenAPI Generation & Hot-Swap

### MCP → OpenAPI 3.1 Mapping

| MCP                        | OpenAPI                          |
|----------------------------|----------------------------------|
| `tools/list` response      | `paths{}`                        |
| `tool.name`                | `POST /tools/{name}`             |
| `tool.description`         | `summary` + `description`        |
| `tool.inputSchema`         | `requestBody` (JSON Schema)      |

**Example:**
```json
GET /openapi.json
{
  "openapi": "3.1.0",
  "info": { "title": "github MCP Bridge", "version": "1.0.0" },
  "paths": {
    "/tools/create_issue": {
      "post": {
        "summary": "Create a GitHub issue",
        "requestBody": { "content": { "application/json": { "schema": { ... } } } },
        "responses": { "200": { "description": "Tool result" } }
      }
    }
  }
}
```

ChatGPT Custom GPT / Gemini Plugin registers `http://localhost:3000/openapi.json` once — done.

### Hot-Swap

`ConfigWatcher` monitors the Claude/Cursor/Cline config file via `fs.watch`. On change (server added, removed, or updated):

1. New `tools/list` call against all active subprocesses
2. OpenAPI spec is reactively regenerated
3. In-flight requests are not interrupted
4. Log entry: `[hot-swap] 14 tools → 17 tools (new-tool-xyz added)`

**UX promise:** Register the bridge URL once in ChatGPT/Gemini. After that, `mcpinv install <server>` is all it takes — no restart, no reconfiguration.

---

## 3. Error Handling & Logging

### Error Classes

| Error class           | Detection              | HTTP response         | Behavior                            |
|-----------------------|------------------------|-----------------------|-------------------------------------|
| Subprocess crash      | `process.on('exit')`   | 503 on all /tools/*   | 3x restart with exponential backoff |
| Tool call failure     | MCP error response     | 422 + JSON error      | Structured error message returned   |
| Invalid parameters    | Zod validation         | 400 + details         | MCP server not burdened             |
| Port in use           | `EADDRINUSE`           | —                     | Clear message + `--port` hint       |

**Structured error response:**
```json
{
  "error": "tool_failed",
  "message": "Repository not found",
  "tool": "create_issue",
  "suggestion": "Check that the repository exists and you have write access"
}
```

**Logging:** Structured JSON to `~/.mcpinv/logs/bridge-<server-id>.log`, consistent with existing server logs. Every request, tool call, restart, and hot-swap is logged.

---

## 4. `mcpinv serve` CLI Command

```
mcpinv serve <server-id> [--port 3000] [--host localhost] [--no-watch] [--no-telemetry]
```

**Options:**

| Flag             | Default     | Description                                                |
|------------------|-------------|------------------------------------------------------------|
| `--port`         | `3000`      | HTTP port                                                  |
| `--host`         | `localhost` | `0.0.0.0` for network access (with explicit warning)       |
| `--no-watch`     | off         | Disable hot-swap                                           |
| `--no-telemetry` | off         | Disable error DB lookup and AI diagnosis                   |

**Startup output:**
```
✓ MCP server started (github)
✓ 12 tools discovered
✓ Bridge running on http://localhost:3000
  OpenAPI spec:  http://localhost:3000/openapi.json
  Tool list:     http://localhost:3000/tools
  Watching for config changes... (--no-watch to disable)
```

The command runs in the foreground. `Ctrl+C` shuts down the bridge and subprocess cleanly (SIGTERM → SIGKILL after 5s).

---

## 5. `mcpinv diagnose` — AI-Guided Diagnosis Assistant

### Three-Tier Model

```
Tier 1 — Local (offline, instant)
  Pattern matching against known error classes
  → immediate fix suggestion, no API call

Tier 2 — Error DB (online, anonymous)
  GET https://errors.mcpinv.dev/lookup?sig=<stderr-hash>
  → community-curated guides with OS tags (Windows/macOS/Linux)

Tier 3 — AI Assistant (online, interactive)
  Streaming dialog with Claude via mcpinv API
  User answers feed back as context
  Fix found → "Save as community guide?"
  → POST https://errors.mcpinv.dev/report (with explicit consent)
```

### Local Pattern Matches (Tier 1)

| Error class          | Detection                  | Suggestion                               |
|----------------------|----------------------------|------------------------------------------|
| Binary not found     | `ENOENT`                   | Check path / re-run `mcpinv install`     |
| Missing dependency   | `Cannot find module`       | `npm install` in server directory        |
| Port in use          | `EADDRINUSE`               | Use `--port` option                      |
| Missing secret       | MCP auth error             | Run `mcpinv migrate`                     |
| Subprocess crash     | exit code ≠ 0              | Check stderr + `mcpinv logs <id>`        |

### Interactive Dialog (Tier 3)

```
mcpinv diagnose github

✗ Problem detected: MCP server failed to start
  Exit code 1 · stderr: Cannot find module '@octokit/rest'

? What would you like to do?
  › Start interactive diagnosis (AI-guided)
    Look up error in community DB
    Share error + request fix suggestion
    Cancel

────────────────────────────────────────
  mcpinv Diagnosis Assistant
────────────────────────────────────────
  I've analyzed your error...
  [Streaming dialog with Claude]

  Fix found ✓
  ? Save this fix as a community guide?
    › Yes, share anonymously
      No
```

### AI Guide Generation

When a fix is found via Tier 3, Claude automatically generates an OS-specific guide:

```json
{
  "error_sig": "sha256:abc123",
  "server_type": "node",
  "cause": "missing_dependency",
  "fixes": {
    "windows": ["cd %APPDATA%\\mcpinv\\servers\\github", "npm install"],
    "macos":   ["cd ~/.mcpinv/servers/github", "npm install"],
    "linux":   ["cd ~/.mcpinv/servers/github", "npm install"]
  },
  "contributed_by": "community",
  "verified": false
}
```

Guides grow over time through community contributions. Fixes reviewed by the mcpinv team are marked `"verified": true`.

### Privacy

`--no-telemetry` disables Tier 2 and Tier 3 entirely. The following are never transmitted: file paths, usernames, secrets, or personal data. Only sent: anonymized stderr pattern, exit code, OS, Node version, server type.

---

## 6. Dependencies

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "fastify": "^4.0.0",
    "zod": "^3.0.0",
    "zod-to-json-schema": "^3.0.0",
    "inquirer": "^10.0.0",
    "chalk": "^5.0.0"
  }
}
```
