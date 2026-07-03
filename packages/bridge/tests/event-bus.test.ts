import { describe, it, expect } from 'vitest'
import { EventBus } from '../src/event-bus.js'
import type { CockpitEvent } from '../src/event-bus.js'

describe('EventBus', () => {
  it('delivers emitted events to listeners', () => {
    const bus = new EventBus()
    const received: CockpitEvent[] = []
    bus.on_event(e => received.push(e))
    bus.emit_event({ type: 'tool_call', data: {
      id: 1, ts: Date.now(), server_id: 's', tool_name: 't',
      duration_ms: 10, input_tokens: null, output_tokens: null,
      success: true, error_msg: null
    }})
    expect(received).toHaveLength(1)
    expect(received[0].type).toBe('tool_call')
  })

  it('off_event stops delivery', () => {
    const bus = new EventBus()
    const received: CockpitEvent[] = []
    const listener = (e: CockpitEvent) => received.push(e)
    bus.on_event(listener)
    bus.off_event(listener)
    bus.emit_event({ type: 'server_up', data: { ts: Date.now(), server_id: 's' } })
    expect(received).toHaveLength(0)
  })
})
