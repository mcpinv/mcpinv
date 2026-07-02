import Fastify from 'fastify'
import { appendFileSync, mkdirSync } from 'fs'
import { createHash } from 'crypto'
import { dirname } from 'path'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import type Database from 'better-sqlite3'
import type { McpClient } from './mcp-client.js'
import { generateOpenApiSpec } from './openapi.js'
import type { BridgeServerOptions } from './types.js'
import { openDb, insertToolCall } from './db.js'
import { EventBus } from './event-bus.js'

export class BridgeServer {
  private fastify = Fastify({ logger: false })
  private tools: Tool[] = []
  private spec: object = {}
  private started = false
  private db: Database.Database
  readonly eventBus: EventBus

  constructor(
    private readonly client: McpClient,
    private readonly options: BridgeServerOptions,
    db?: Database.Database,
    eventBus?: EventBus
  ) {
    this.db = db ?? openDb(options.dbPath)
    this.eventBus = eventBus ?? new EventBus()
  }

  async start(): Promise<void> {
    if (this.started) return
    this.tools = await this.client.listTools()
    this.spec = generateOpenApiSpec(this.options.serverId, this.tools)
    this.registerRoutes()
    await this.fastify.listen({ port: this.options.port, host: this.options.host })
    this.started = true
    this.eventBus.emit_event({ type: 'server_up', data: { ts: Date.now(), server_id: this.options.serverId } })
    this.log(`bridge started on ${this.options.host}:${this.options.port}`)
  }

  updateTools(tools: Tool[]): void {
    const before = this.tools.length
    this.tools = tools
    this.spec = generateOpenApiSpec(this.options.serverId, tools)
    this.log(`[hot-swap] ${before} tools → ${tools.length} tools`)
  }

  private registerRoutes(): void {
    this.fastify.get('/openapi.json', async () => this.spec)

    this.fastify.get('/tools', async () => ({
      tools: this.tools.map(t => ({ name: t.name, description: t.description ?? '' }))
    }))

    this.fastify.post<{ Params: { name: string }; Body: Record<string, unknown> }>(
      '/tools/:name',
      async (request, reply) => {
        const tool = this.tools.find(t => t.name === request.params.name)
        if (!tool) {
          return reply.code(404).send({ error: 'tool_not_found', tool: request.params.name })
        }
        const start = Date.now()
        try {
          const result = await this.client.callTool(request.params.name, request.body ?? {})
          const duration_ms = Date.now() - start
          const id = insertToolCall(this.db, {
            ts: Date.now(),
            server_id: this.options.serverId,
            tool_name: request.params.name,
            args_hash: createHash('sha256').update(JSON.stringify(request.body ?? {})).digest('hex').slice(0, 16),
            duration_ms,
            input_tokens: null,
            output_tokens: null,
            success: 1,
            error_msg: null
          })
          this.eventBus.emit_event({ type: 'tool_call', data: {
            id, ts: Date.now(), server_id: this.options.serverId,
            tool_name: request.params.name, duration_ms,
            input_tokens: null, output_tokens: null,
            success: true, error_msg: null
          }})
          this.log(`[tool] ${request.params.name} ok`)
          return result
        } catch (err) {
          const duration_ms = Date.now() - start
          const message = err instanceof Error ? err.message : String(err)
          insertToolCall(this.db, {
            ts: Date.now(),
            server_id: this.options.serverId,
            tool_name: request.params.name,
            args_hash: createHash('sha256').update(JSON.stringify(request.body ?? {})).digest('hex').slice(0, 16),
            duration_ms,
            input_tokens: null,
            output_tokens: null,
            success: 0,
            error_msg: message.slice(0, 500)
          })
          this.log(`[tool] ${request.params.name} error: ${message}`)
          return reply.code(422).send({ error: 'tool_failed', message, tool: request.params.name })
        }
      }
    )
  }

  private log(message: string): void {
    const entry = JSON.stringify({ ts: new Date().toISOString(), msg: message })
    try {
      mkdirSync(dirname(this.options.logPath), { recursive: true })
      appendFileSync(this.options.logPath, entry + '\n')
    } catch (err) {
      console.error(`[BridgeServer] Failed to write log: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async stop(): Promise<void> {
    if (this.started) {
      this.eventBus.emit_event({ type: 'server_down', data: { ts: Date.now(), server_id: this.options.serverId } })
      await this.fastify.close()
      this.started = false
    }
  }
}
