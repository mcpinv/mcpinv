import { describe, it, expect, vi } from 'vitest'

vi.mock('@mcpinv/bridge', () => ({
  collectContext: vi.fn().mockResolvedValue({
    serverId: 'github', exitCode: 1, stderr: 'Cannot find module', os: 'linux', nodeVersion: '20.0.0', hasNodeModules: false
  }),
  analyzeLocally: vi.fn().mockReturnValue({ cause: 'missing_dependency', suggestion: 'Run npm install' }),
  lookupError: vi.fn().mockResolvedValue(null),
  reportError: vi.fn().mockResolvedValue(undefined),
  runAssistant: vi.fn().mockResolvedValue({ fix: 'Run npm install', guide: null })
}))

import { diagnoseCommand } from '../../src/commands/diagnose.js'

describe('diagnoseCommand', () => {
  it('creates a Command named diagnose', () => {
    const cmd = diagnoseCommand()
    expect(cmd.name()).toBe('diagnose')
  })

  it('requires a server-id argument', () => {
    const cmd = diagnoseCommand()
    expect(cmd.registeredArguments[0].name()).toBe('server-id')
  })
})
