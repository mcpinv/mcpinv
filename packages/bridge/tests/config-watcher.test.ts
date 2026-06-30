import { describe, it, expect, vi, afterEach } from 'vitest'
import { ConfigWatcher } from '../src/config-watcher.js'
import { writeFileSync, mkdtempSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

describe('ConfigWatcher', () => {
  let watcher: ConfigWatcher

  afterEach(() => watcher?.stop())

  it('calls onChange when file is modified', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcpinv-test-'))
    const file = join(dir, 'config.json')
    writeFileSync(file, '{}')

    const onChange = vi.fn()
    watcher = new ConfigWatcher()
    watcher.watch(file, onChange)

    await new Promise<void>(resolve => setTimeout(resolve, 50))
    writeFileSync(file, '{"updated": true}')
    await new Promise<void>(resolve => setTimeout(resolve, 200))

    expect(onChange).toHaveBeenCalled()
  })

  it('stop() prevents further callbacks', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcpinv-test-'))
    const file = join(dir, 'config.json')
    writeFileSync(file, '{}')

    const onChange = vi.fn()
    watcher = new ConfigWatcher()
    watcher.watch(file, onChange)
    watcher.stop()

    writeFileSync(file, '{"after-stop": true}')
    await new Promise<void>(resolve => setTimeout(resolve, 200))

    expect(onChange).not.toHaveBeenCalled()
  })
})
