import { describe, it, expect, vi, afterEach } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'
import { writeFile } from 'fs/promises'
import { randomUUID } from 'crypto'

// Mock fetch for probePort tests
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// Mock child_process for scanListeningPorts tests
vi.mock('child_process', () => ({
  execFile: vi.fn()
}))

import { probePort, readPortFromConfig, findBridgePort, scanListeningPorts } from '../src/process-scanner.js'

afterEach(() => { vi.clearAllMocks() })

describe('probePort', () => {
  it('returns true when fetch /tools responds ok', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true })
    expect(await probePort(3001)).toBe(true)
    expect(mockFetch).toHaveBeenCalledWith('http://localhost:3001/tools', expect.objectContaining({ signal: expect.any(AbortSignal) }))
  })

  it('returns false when fetch throws (connection refused)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    expect(await probePort(3001)).toBe(false)
  })

  it('returns false when response is not ok', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false })
    expect(await probePort(3002)).toBe(false)
  })
})

describe('readPortFromConfig', () => {
  it('returns null when server not in config', async () => {
    const configPath = join(tmpdir(), `claude-config-${randomUUID()}.json`)
    await writeFile(configPath, JSON.stringify({ mcpServers: {} }))
    expect(await readPortFromConfig('unknown-server', configPath)).toBeNull()
  })

  it('extracts --port from original args of a wired server', async () => {
    const configPath = join(tmpdir(), `claude-config-${randomUUID()}.json`)
    await writeFile(configPath, JSON.stringify({
      mcpServers: {
        'my-server': {
          __mcpinv_original__: { command: 'uvx', args: ['my-server', '--port', '3042'] },
          command: 'mcpinv', args: ['serve', 'my-server', '--stdio']
        }
      }
    }))
    expect(await readPortFromConfig('my-server', configPath)).toBe(3042)
  })

  it('extracts --port from unwired server args', async () => {
    const configPath = join(tmpdir(), `claude-config-${randomUUID()}.json`)
    await writeFile(configPath, JSON.stringify({
      mcpServers: {
        'raw-server': { command: 'node', args: ['server.js', '--port', '3099'] }
      }
    }))
    expect(await readPortFromConfig('raw-server', configPath)).toBe(3099)
  })

  it('returns null when no --port in args', async () => {
    const configPath = join(tmpdir(), `claude-config-${randomUUID()}.json`)
    await writeFile(configPath, JSON.stringify({
      mcpServers: { 'no-port': { command: 'uvx', args: ['no-port'] } }
    }))
    expect(await readPortFromConfig('no-port', configPath)).toBeNull()
  })
})

describe('scanListeningPorts', () => {
  it('returns parsed localhost ports from netstat output (Windows format)', async () => {
    const { execFile } = await import('child_process')
    vi.mocked(execFile).mockImplementation((_cmd, _args, cb: any) => {
      cb(null, `
  Proto  Local Address          Foreign Address        State           PID
  TCP    127.0.0.1:3001         0.0.0.0:0              LISTENING       1234
  TCP    127.0.0.1:3042         0.0.0.0:0              LISTENING       5678
  TCP    0.0.0.0:80             0.0.0.0:0              LISTENING       4
      `, '')
      return {} as any
    })
    const ports = await scanListeningPorts()
    expect(ports).toContain(3001)
    expect(ports).toContain(3042)
    expect(ports).not.toContain(80) // 0.0.0.0 excluded (not localhost)
  })

  it('returns empty array when OS command fails', async () => {
    const { execFile } = await import('child_process')
    vi.mocked(execFile).mockImplementation((_cmd, _args, cb: any) => {
      cb(new Error('command not found'), '', '')
      return {} as any
    })
    expect(await scanListeningPorts()).toEqual([])
  })
})

describe('findBridgePort', () => {
  it('returns first candidate port that probes ok', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('ECONNREFUSED')) // port 3001 dead
      .mockResolvedValueOnce({ ok: true })               // port 3042 alive
    expect(await findBridgePort([3001, 3042])).toBe(3042)
  })

  it('falls back to OS scan when all candidates fail', async () => {
    const { execFile } = await import('child_process')
    vi.mocked(execFile).mockImplementation((_cmd, _args, cb: any) => {
      cb(null, '  TCP    127.0.0.1:3099         0.0.0.0:0              LISTENING       9999\n', '')
      return {} as any
    })
    mockFetch
      .mockRejectedValueOnce(new Error('dead')) // 3001 dead
      .mockResolvedValueOnce({ ok: true })       // 3099 (from OS scan) alive
    expect(await findBridgePort([3001])).toBe(3099)
  })

  it('returns null when nothing responds', async () => {
    const { execFile } = await import('child_process')
    vi.mocked(execFile).mockImplementation((_cmd, _args, cb: any) => {
      cb(null, '', '')
      return {} as any
    })
    mockFetch.mockRejectedValue(new Error('dead'))
    expect(await findBridgePort([3001, 3002])).toBeNull()
  })
})
