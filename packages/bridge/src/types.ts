export interface McpClientOptions {
  command: string
  args: string[]
  env?: Record<string, string>
}

export interface BridgeServerOptions {
  serverId: string
  port: number
  host: string
  logPath: string
  dbPath?: string   // path to cockpit SQLite DB; defaults to ~/.mcpinv/cockpit.db
  cockpitUrl?: string  // default: 'http://localhost:3000'
}

export interface DiagnosisContext {
  serverId: string
  exitCode: number | null
  stderr: string
  os: string
  nodeVersion: string
  hasNodeModules: boolean
}

export interface ErrorPattern {
  cause: string
  suggestion: string
}

export interface CockpitServerOptions {
  port: number
  host: string
  dbPath?: string
  cliBin?: string  // path to mcpinv CLI script; enables Cockpit-initiated bridge spawn
}

export interface ErrorGuide {
  error_sig: string
  server_type: string
  cause: string
  fixes: {
    windows: string[]
    macos: string[]
    linux: string[]
  }
  contributed_by: string
  verified: boolean
}
