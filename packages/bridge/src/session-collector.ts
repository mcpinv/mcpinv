import { readdirSync, watch, existsSync } from 'fs'
import { join, extname } from 'path'
import { homedir } from 'os'
import type Database from 'better-sqlite3'
import { ClaudeCodeAdapter } from './claude-code-adapter.js'

export interface CollectorConfig {
  enabled: boolean
  dirs: Array<{ path: string; enabled: boolean; auto: boolean }>
}

/** Scans ~/.claude/projects/ for subdirectories (one level deep). */
export function discoverDefaultDirs(): string[] {
  const base = join(homedir(), '.claude', 'projects')
  if (!existsSync(base)) return []
  try {
    return readdirSync(base, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => join(base, e.name))
  } catch {
    return []
  }
}

export class SessionCollector {
  private watchers: ReturnType<typeof watch>[] = []
  private lastRunAt: number | null = null
  private readonly adapter: ClaudeCodeAdapter

  constructor(
    private readonly db: Database.Database,
    private config: CollectorConfig
  ) {
    this.adapter = new ClaudeCodeAdapter(db)
  }

  /** Activates fs.watch on all enabled dirs. Replaces any existing watchers. */
  start(): void {
    this.stop()
    if (!this.config.enabled) return
    for (const dir of this.config.dirs) {
      if (!dir.enabled || !existsSync(dir.path)) continue
      try {
        const watcher = watch(dir.path, { persistent: false }, (_event, filename) => {
          if (filename && extname(filename) === '.jsonl') {
            const fullPath = join(dir.path, filename)
            this.adapter.ingest(fullPath).catch(() => {})
          }
        })
        this.watchers.push(watcher)
      } catch {
        // Directory may disappear between check and watch — non-fatal.
      }
    }
  }

  /** Stops all active file watchers. */
  stop(): void {
    for (const w of this.watchers) {
      try { w.close() } catch { /* already closed */ }
    }
    this.watchers = []
  }

  /** Ingests every .jsonl file found in all enabled dirs. */
  async ingestAll(): Promise<{ ingested: number; skipped: number }> {
    let ingested = 0
    let skipped = 0
    for (const dir of this.config.dirs) {
      if (!dir.enabled || !existsSync(dir.path)) continue
      let files: string[]
      try {
        files = readdirSync(dir.path)
          .filter(f => extname(f) === '.jsonl')
          .map(f => join(dir.path, f))
      } catch {
        continue
      }
      for (const file of files) {
        try {
          const result = await this.adapter.ingest(file)
          if (result.skipped) skipped++
          else ingested++
        } catch {
          // Per-file errors are non-fatal; continue with remaining files.
        }
      }
    }
    this.lastRunAt = Date.now()
    return { ingested, skipped }
  }

  /** Replaces the current config and restarts watchers if enabled. */
  updateConfig(config: CollectorConfig): void {
    this.config = config
    if (config.enabled) {
      this.start()
    } else {
      this.stop()
    }
  }

  getConfig(): CollectorConfig {
    return { ...this.config, dirs: [...this.config.dirs] }
  }

  getStatus(): { enabled: boolean; watchedDirs: string[]; lastRunAt: number | null } {
    return {
      enabled: this.config.enabled,
      watchedDirs: this.config.dirs.filter(d => d.enabled).map(d => d.path),
      lastRunAt: this.lastRunAt
    }
  }
}
