import Fastify from 'fastify'
import type Database from 'better-sqlite3'
import { openDb } from './db.js'
import { EventBus } from './event-bus.js'
import { ActiveRegistry } from './registry.js'
import { registerApiRoutes } from './api-routes.js'
import { reconnectKnownServers } from './reconnect.js'
import type { CockpitServerOptions } from './types.js'
import { openAnalyticsDb } from './analytics-db.js'
import { SessionCollector, discoverDefaultDirs } from './session-collector.js'

export class CockpitServer {
  private readonly fastify = Fastify({ logger: false })
  private started = false
  private readonly db: Database.Database
  private analyticsDb: Database.Database | undefined
  private collector: SessionCollector | undefined
  readonly eventBus: EventBus
  readonly registry: ActiveRegistry

  constructor(private readonly options: CockpitServerOptions) {
    this.db = openDb(options.dbPath)
    this.eventBus = new EventBus()
    this.registry = new ActiveRegistry()
  }

  async start(): Promise<void> {
    if (this.started) return

    this.analyticsDb = openAnalyticsDb()
    const analyticsDb = this.analyticsDb
    const defaultDirs = discoverDefaultDirs()
    this.collector = new SessionCollector(analyticsDb, {
      enabled: false,
      dirs: defaultDirs.map(p => ({ path: p, enabled: true, auto: true }))
    })

    try {
      const { default: fastifyStatic } = await import('@fastify/static')
      const { join: pathJoin, dirname: pathDirname } = await import('path')
      const { fileURLToPath } = await import('url')
      const __dir = pathDirname(fileURLToPath(import.meta.url))
      await this.fastify.register(fastifyStatic, {
        root: pathJoin(__dir, 'public'),
        prefix: '/'
      })
    } catch {
      // public dir absent in development — UI runs on Vite :5173
    }

    await registerApiRoutes(this.fastify, this.db, this.eventBus, this.registry, this.options.cliBin, this.collector, analyticsDb)
    await this.fastify.listen({ port: this.options.port, host: this.options.host })
    this.started = true
    reconnectKnownServers(this.db, this.registry, this.eventBus).catch(() => {})
  }

  async stop(): Promise<void> {
    if (this.started) {
      this.collector?.stop()
      this.analyticsDb?.close()
      await this.fastify.close()
      this.started = false
    }
  }
}
