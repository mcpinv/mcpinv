import { describe, it, expect, vi } from 'vitest'
import { cockpitCommand } from '../../src/commands/cockpit.js'

vi.mock('open', () => ({ default: vi.fn().mockResolvedValue(undefined) }))

describe('cockpitCommand', () => {
  it('is a command named "cockpit" with alias "cp"', () => {
    const cmd = cockpitCommand()
    expect(cmd.name()).toBe('cockpit')
    expect(cmd.aliases()).toContain('cp')
  })

  it('opens the cockpit URL in the browser', async () => {
    const open = (await import('open')).default

    await cockpitCommand().parseAsync([], { from: 'user' })

    expect(open).toHaveBeenCalledWith('http://localhost:3000')
  })

  it('respects --port option', async () => {
    const open = (await import('open')).default
    vi.mocked(open).mockClear()

    await cockpitCommand().parseAsync(['--port', '4000'], { from: 'user' })

    expect(open).toHaveBeenCalledWith('http://localhost:4000')
  })
})
