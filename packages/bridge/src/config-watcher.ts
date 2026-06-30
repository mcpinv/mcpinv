import { watch, type FSWatcher } from 'fs'

export class ConfigWatcher {
  private watcher: FSWatcher | null = null

  watch(filePath: string, onChange: () => void): void {
    this.watcher?.close()
    this.watcher = watch(filePath, { persistent: false }, () => onChange())
  }

  stop(): void {
    this.watcher?.close()
    this.watcher = null
  }
}
