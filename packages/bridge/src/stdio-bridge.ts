import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema
} from '@modelcontextprotocol/sdk/types.js'
import type { Readable, Writable } from 'stream'
import type Database from 'better-sqlite3'
import { appendFileSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { createHash } from 'crypto'
import type { McpClient } from './mcp-client.js'
import { openDb, insertToolCall, upsertKnownServer } from './db.js'

export interface StdioBridgeOptions {
  serverId: string
  dbPath?: string
  cockpitUrl?: string  // default: 'http://localhost:3000'
  logPath: string
}

export class StdioBridge {
  private server: Server
  private transport: StdioServerTransport
  private readonly db: Database.Database
  private readonly ownsDb: boolean
  private started = false
  private logDirReady = false

  constructor(
    private readonly client: McpClient,
    private readonly options: StdioBridgeOptions,
    db?: Database.Database,
    stdin?: Readable,
    stdout?: Writable
  ) {
    this.ownsDb = !db
    this.db = db ?? openDb(options.dbPath)
    this.server = new Server(
      { name: options.serverId, version: '1.0.0' },
      { capabilities: { tools: {} } }
    )
    this.transport = new StdioServerTransport(stdin, stdout)
  }

  async start(): Promise<void> {
    if (this.started) return

    await this.client.connect()
    const tools = await this.client.listTools()
    upsertKnownServer(this.db, this.options.serverId)

    // Serve the upstream tool list with their raw JSON inputSchema so that
    // downstream clients (e.g. Claude Desktop) see the correct parameter schema
    // for each tool.
    this.server.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description ?? '',
        inputSchema: tool.inputSchema ?? { type: 'object' as const, properties: {} }
      }))
    }))

    // Forward tool calls to the upstream MCP client and record them in the DB.
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name
      const args = (request.params.arguments ?? {}) as Record<string, unknown>
      const argsHash = createHash('sha256')
        .update(JSON.stringify(args))
        .digest('hex')
        .slice(0, 16)
      const start = Date.now()

      try {
        const result = await this.client.callTool(toolName, args)
        const duration_ms = Date.now() - start
        const ts = Date.now()
        insertToolCall(this.db, {
          ts,
          server_id: this.options.serverId,
          tool_name: toolName,
          args_hash: argsHash,
          duration_ms,
          input_tokens: null,
          output_tokens: null,
          success: 1,
          error_msg: null
        })
        this.notifyCockpit('tool_call', { ts, server_id: this.options.serverId, tool_name: toolName, duration_ms, success: true })
        this.log(`[tool] ${toolName} ok`)
        return { content: result as any }
      } catch (err) {
        const duration_ms = Date.now() - start
        const ts = Date.now()
        const message = err instanceof Error ? err.message : String(err)
        insertToolCall(this.db, {
          ts,
          server_id: this.options.serverId,
          tool_name: toolName,
          args_hash: argsHash,
          duration_ms,
          input_tokens: null,
          output_tokens: null,
          success: 0,
          error_msg: message.slice(0, 500)
        })
        this.log(`[tool] ${toolName} error: ${message}`)
        throw err
      }
    })

    await this.server.connect(this.transport)
    this.started = true

    // Register with cockpit (non-fatal)
    const cockpitUrl = this.options.cockpitUrl ?? 'http://localhost:3000'
    fetch(`${cockpitUrl}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ server_id: this.options.serverId, port: 0, mode: 'stdio' })
    }).catch(() => {})

    this.log(`stdio bridge started for ${this.options.serverId}`)
  }

  async stop(): Promise<void> {
    if (!this.started) return
    try {
      const cockpitUrl = this.options.cockpitUrl ?? 'http://localhost:3000'
      await fetch(`${cockpitUrl}/api/register/${this.options.serverId}`, {
        method: 'DELETE'
      }).catch(() => {})
      await this.server.close()
      await this.client.close()
    } finally {
      if (this.ownsDb) this.db.close()
      this.started = false
    }
  }

  private notifyCockpit(type: string, data: unknown): void {
    const cockpitUrl = this.options.cockpitUrl ?? 'http://localhost:3000'
    fetch(`${cockpitUrl}/api/events/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, data })
    }).catch(() => {})
  }

  private log(message: string): void {
    const entry = JSON.stringify({ ts: new Date().toISOString(), msg: message })
    try {
      if (!this.logDirReady) {
        mkdirSync(dirname(this.options.logPath), { recursive: true })
        this.logDirReady = true
      }
      appendFileSync(this.options.logPath, entry + '\n')
    } catch {
      // log failure is non-fatal
    }
  }
}
