# mcpinv — invoke anything

Install, run and host MCP servers in seconds.

## Install

```bash
npm install -g mcpinv
```

## Usage

```bash
inv search github                 # find MCP servers
inv install github-mcp-server     # install + inject into Claude/Cursor (secrets in Keychain)
inv status                        # list installed servers
inv logs github-mcp-server        # tail logs
inv remove github-mcp-server      # uninstall + remove secrets
inv migrate                       # move existing plaintext tokens to OS Keychain
inv update                        # check for updates
```

## Cockpit — local MCP dashboard

Cockpit gives you a live view of all your MCP servers: call log, token usage, start/stop controls.

### Quick start

```bash
# 1. Import your existing MCP servers from Claude Desktop
mcpinv import

# 2. Wire Claude Desktop to route calls through mcpinv (enables live telemetry)
mcpinv import --wire
# → Restart Claude Desktop after this step

# 3. Open the Cockpit dashboard (keep this running in a terminal)
mcpinv cockpit
# → Opens http://localhost:3000 in your browser
```

### What "wiring" does

`mcpinv import --wire` rewrites your `claude_desktop_config.json` so that every MCP server call is proxied through `mcpinv serve <id> --stdio`. This gives the Cockpit real-time telemetry without requiring any changes to your MCP servers themselves. The original server config is preserved and can be restored by removing the `mcpinv` entries.

### Server lifecycle

| State | Meaning |
|---|---|
| Running | Bridge process is active and accepting calls |
| Stopped | No bridge running — click Start or use `mcpinv serve <id>` |

When Cockpit starts, it automatically reconnects any bridge processes that survived a previous Cockpit session.

## How it works

- Discovers MCP servers via [Smithery](https://smithery.ai)
- Secrets stored in your OS Keychain — never in config files
- Auto-injects into Claude Desktop, Cursor, and Cline
- Works on Windows, macOS, Linux

## Security

`inv migrate` scans your existing MCP configs for plaintext tokens and moves them into the OS Keychain automatically.

## License

MIT
