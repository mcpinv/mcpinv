import { describe, it, expect, vi } from 'vitest'

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn()
  }
}))

import axios from 'axios'
import { lookupError, reportError } from '../../src/diagnose/error-db.js'

describe('lookupError', () => {
  it('returns guide when found', async () => {
    const guide = { error_sig: 'abc', cause: 'missing_dependency', fixes: { windows: [], macos: [], linux: [] }, verified: false, contributed_by: 'community', server_type: 'node' }
    vi.mocked(axios.get).mockResolvedValueOnce({ data: { guide } })
    const result = await lookupError('abc123')
    expect(result?.cause).toBe('missing_dependency')
  })

  it('returns null on 404', async () => {
    vi.mocked(axios.get).mockRejectedValueOnce({ response: { status: 404 } })
    const result = await lookupError('unknown')
    expect(result).toBeNull()
  })

  it('returns null on network error', async () => {
    vi.mocked(axios.get).mockRejectedValueOnce(new Error('network'))
    const result = await lookupError('abc')
    expect(result).toBeNull()
  })
})

describe('reportError', () => {
  it('posts anonymized context', async () => {
    vi.mocked(axios.post).mockResolvedValueOnce({ data: { ok: true } })
    await reportError({ serverId: 'github', exitCode: 1, stderr: 'Cannot find module', os: 'linux', nodeVersion: '20.0.0', hasNodeModules: false })
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('errors.mcpinv.dev'),
      expect.objectContaining({ stderr: 'Cannot find module', os: 'linux' }),
      expect.any(Object)
    )
  })
})
