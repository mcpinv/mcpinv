export interface ActiveEntry {
  server_id: string
  port: number
  started_at: number
}

export class ActiveRegistry {
  private readonly entries = new Map<string, ActiveEntry>()

  register(server_id: string, port: number): void {
    this.entries.set(server_id, { server_id, port, started_at: Date.now() })
  }

  unregister(server_id: string): void {
    this.entries.delete(server_id)
  }

  getAll(): ActiveEntry[] {
    return Array.from(this.entries.values())
  }

  get(server_id: string): ActiveEntry | undefined {
    return this.entries.get(server_id)
  }
}
