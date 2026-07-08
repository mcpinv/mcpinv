import { describe, it, expect, beforeEach } from 'vitest'
import { ActiveRegistry } from '../src/registry.js'

describe('ActiveRegistry', () => {
  let reg: ActiveRegistry

  beforeEach(() => { reg = new ActiveRegistry() })

  it('register adds a server entry', () => {
    reg.register('mira-local', 3001)
    const all = reg.getAll()
    expect(all).toHaveLength(1)
    expect(all[0].server_id).toBe('mira-local')
    expect(all[0].port).toBe(3001)
    expect(all[0].started_at).toBeGreaterThan(0)
  })

  it('register is idempotent — second call updates port', () => {
    reg.register('mira-local', 3001)
    reg.register('mira-local', 3002)
    expect(reg.getAll()).toHaveLength(1)
    expect(reg.get('mira-local')?.port).toBe(3002)
  })

  it('unregister removes a server entry', () => {
    reg.register('mira-local', 3001)
    reg.unregister('mira-local')
    expect(reg.getAll()).toHaveLength(0)
  })

  it('unregister on unknown id is a no-op', () => {
    expect(() => reg.unregister('unknown')).not.toThrow()
  })

  it('get returns undefined for unknown id', () => {
    expect(reg.get('unknown')).toBeUndefined()
  })
})
