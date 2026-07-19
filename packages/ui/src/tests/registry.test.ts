import { describe, it, expect } from 'vitest'
import { panels } from '../registry.js'

describe('panel registry', () => {
  it('has 5 panels', () => {
    expect(panels).toHaveLength(5)
  })

  it('each panel has required fields', () => {
    for (const p of panels) {
      expect(p.id).toBeTruthy()
      expect(p.label).toBeTruthy()
      expect(p.route).toMatch(/^\//)
      expect(typeof p.component).toBe('function')
    }
  })

  it('panel ids are unique', () => {
    const ids = panels.map(p => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('panels are sorted by order', () => {
    const orders = panels.map(p => p.order ?? 100)
    for (let i = 1; i < orders.length; i++) {
      expect(orders[i]).toBeGreaterThanOrEqual(orders[i - 1])
    }
  })
})
