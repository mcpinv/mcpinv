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

## How it works

- Discovers MCP servers via [Smithery](https://smithery.ai)
- Secrets stored in your OS Keychain — never in config files
- Auto-injects into Claude Desktop, Cursor, and Cline
- Works on Windows, macOS, Linux

## Security

`inv migrate` scans your existing MCP configs for plaintext tokens and moves them into the OS Keychain automatically.

## License

MIT
