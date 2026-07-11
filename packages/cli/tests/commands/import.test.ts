import { describe, it, expect, vi, beforeEach } from 'vitest'
import { importCommand } from '../../src/commands/import.js'

vi.mock('../../src/services/config-manager.js', () => ({
  listInstalled: vi.fn(),
  wireServer: vi.fn()
}))

vi.mock('@mcpinv/bridge', () => ({
  openDb: vi.fn().mockReturnValue({ close: vi.fn() }),
  upsertKnownServer: vi.fn()
}))

describe('importCommand', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('is a command named "import"', () => {
    const cmd = importCommand()
    expect(cmd.name()).toBe('import')
  })

  it('reports found server ids', async () => {
    const { listInstalled } = await import('../../src/services/config-manager.js')
    vi.mocked(listInstalled).mockResolvedValue(['mira-memory', 'filesystem'])

    const lines: string[] = []
    const origLog = console.log
    console.log = (...args: unknown[]) => lines.push(args.join(' '))

    await importCommand().parseAsync([], { from: 'user' })

    console.log = origLog

    expect(lines.some(l => l.includes('mira-memory'))).toBe(true)
    expect(lines.some(l => l.includes('filesystem'))).toBe(true)
  })

  it('reports the count of discovered servers', async () => {
    const { listInstalled } = await import('../../src/services/config-manager.js')
    vi.mocked(listInstalled).mockResolvedValue(['mira-memory', 'mira-local', 'filesystem'])

    const lines: string[] = []
    const origLog = console.log
    console.log = (...args: unknown[]) => lines.push(args.join(' '))

    await importCommand().parseAsync([], { from: 'user' })

    console.log = origLog
    expect(lines.some(l => l.includes('3'))).toBe(true)
  })

  it('shows empty state when no servers configured', async () => {
    const { listInstalled } = await import('../../src/services/config-manager.js')
    vi.mocked(listInstalled).mockResolvedValue([])

    const lines: string[] = []
    const origLog = console.log
    console.log = (...args: unknown[]) => lines.push(args.join(' '))

    await importCommand().parseAsync([], { from: 'user' })

    console.log = origLog
    expect(lines.some(l => l.toLowerCase().includes('no') || l.toLowerCase().includes('keine') || l.toLowerCase().includes('0'))).toBe(true)
  })

  it('--wire flag calls wireServer for each discovered server', async () => {
    const { listInstalled, wireServer } = await import('../../src/services/config-manager.js')
    vi.mocked(listInstalled).mockResolvedValue(['mira-memory'])
    vi.mocked(wireServer).mockResolvedValue(undefined)

    await importCommand().parseAsync(['--wire'], { from: 'user' })

    expect(wireServer).toHaveBeenCalledWith('mira-memory')
  })

  it('writes discovered servers to SQLite known_servers', async () => {
    const { listInstalled } = await import('../../src/services/config-manager.js')
    const { upsertKnownServer, openDb } = await import('@mcpinv/bridge')
    vi.mocked(listInstalled).mockResolvedValue(['mira-memory', 'filesystem'])

    await importCommand().parseAsync([], { from: 'user' })

    expect(openDb).toHaveBeenCalled()
    expect(upsertKnownServer).toHaveBeenCalledWith(expect.anything(), 'mira-memory')
    expect(upsertKnownServer).toHaveBeenCalledWith(expect.anything(), 'filesystem')
  })
})
