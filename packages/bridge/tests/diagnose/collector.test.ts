import { describe, it, expect } from 'vitest'
import { collectContext } from '../../src/diagnose/collector.js'
import { mkdtempSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

describe('collectContext', () => {
  it('returns os and nodeVersion', async () => {
    const ctx = await collectContext('test-server', 1, 'some error', '/nonexistent')
    expect(['win32', 'darwin', 'linux']).toContain(ctx.os)
    expect(ctx.nodeVersion).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('detects missing node_modules', async () => {
    const ctx = await collectContext('test-server', 1, 'error', '/nonexistent/path')
    expect(ctx.hasNodeModules).toBe(false)
  })

  it('detects present node_modules', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcpinv-test-'))
    mkdirSync(join(dir, 'node_modules'))
    const ctx = await collectContext('test-server', 0, '', dir)
    expect(ctx.hasNodeModules).toBe(true)
  })
})
