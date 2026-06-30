import Fastify from 'fastify'
import { appendFileSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import type { McpClient } from './mcp-client.js'
import { generateOpenApiSpec } from './openapi.js'
import type { BridgeServerOptions } from './types.js'

export class BridgeServer {
  private fastify = Fastify({ logger: false })
  private tools: Tool[] = []
  private spec: object = {}
  private started = false

  constructor(
    private readonly client: McpClient,
    private readonly options: BridgeServerOptions
  ) {}

  async start(): Promise<void> {
    this.tools = await this.client.listTools()
    this.spec = generateOpenApiSpec(this.options.serverId, this.tools)
    this.registerRoutes()
    await this.fastify.listen({ port: this.options.port, host: this.options.host })
    this.started = true
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
        try {
          const result = await this.client.callTool(request.params.name, request.body ?? {})
          this.log(`[tool] ${request.params.name} ok`)
          return result
        } catch (err: any) {
          this.log(`[tool] ${request.params.name} error: ${err.message}`)
          return reply.code(422).send({
            error: 'tool_failed',
            message: err.message ?? 'Tool execution failed',
            tool: request.params.name
          })
        }
      }
    )
  }

  private log(message: string): void {
    const entry = JSON.stringify({ ts: new Date().toISOString(), msg: message })
    try {
      mkdirSync(dirname(this.options.logPath), { recursive: true })
      appendFileSync(this.options.logPath, entry + '\n')
    } catch {}
  }

  async stop(): Promise<void> {
    if (this.started) {
      await this.fastify.close()
      this.started = false
    }
  }
}
