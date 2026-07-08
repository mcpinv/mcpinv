import { describe, it, expect, vi } from 'vitest'
import { cockpitCommand } from '../../src/commands/cockpit.js'

vi.mock('open', () => ({ default: vi.fn().mockResolvedValue(undefined) }))

const mockServerInstance = {
  start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined)
}
vi.mock('@mcpinv/bridge', () => ({
  CockpitServer: vi.fn().mockImplementation(() => mockServerInstance)
}))

describe('cockpitCommand', () => {
  it('is a command named "cockpit" with alias "cp"', () => {
    const cmd = cockpitCommand()
    expect(cmd.name()).toBe('cockpit')
    expect(cmd.aliases()).toContain('cp')
  })

  it('starts CockpitServer before opening browser', async () => {
    const { CockpitServer } = await import('@mcpinv/bridge')
    const open = (await import('open')).default
    vi.mocked(open).mockClear()
    vi.mocked(CockpitServer).mockClear()
    mockServerInstance.start.mockClear()

    await cockpitCommand().parseAsync([], { from: 'user' })

    expect(CockpitServer).toHaveBeenCalled()
    expect(mockServerInstance.start).toHaveBeenCalled()
    expect(open).toHaveBeenCalledWith('http://localhost:3000')
  })

  it('respects --port option', async () => {
    const open = (await import('open')).default
    vi.mocked(open).mockClear()

    await cockpitCommand().parseAsync(['--port', '4000'], { from: 'user' })

    expect(open).toHaveBeenCalledWith('http://localhost:4000')
  })
})
