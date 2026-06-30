import { describe, it, expect } from 'vitest'
import { analyzeLocally } from '../../src/diagnose/analyzer.js'
import type { DiagnosisContext } from '../../src/types.js'

const base: DiagnosisContext = { serverId: 'test', exitCode: 1, stderr: '', os: 'linux', nodeVersion: '20.0.0', hasNodeModules: true }

describe('analyzeLocally', () => {
  it('detects ENOENT as binary not found', () => {
    const result = analyzeLocally({ ...base, stderr: 'spawn ENOENT' })
    expect(result?.cause).toBe('binary_not_found')
    expect(result?.suggestion).toContain('mcpinv install')
  })

  it('detects missing module', () => {
    const result = analyzeLocally({ ...base, stderr: "Cannot find module '@octokit/rest'" })
    expect(result?.cause).toBe('missing_dependency')
    expect(result?.suggestion).toContain('npm install')
  })

  it('detects EADDRINUSE', () => {
    const result = analyzeLocally({ ...base, stderr: 'listen EADDRINUSE :::3000' })
    expect(result?.cause).toBe('port_in_use')
    expect(result?.suggestion).toContain('--port')
  })

  it('returns null for unknown error', () => {
    const result = analyzeLocally({ ...base, stderr: 'some completely unknown error xyzzy' })
    expect(result).toBeNull()
  })
})
