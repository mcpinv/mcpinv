import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MonitorPanel } from '../panels/monitor/index.js'

vi.mock('../api/client.js', () => ({
  subscribeEvents: vi.fn(() => () => {}),
}))

describe('MonitorPanel', () => {
  afterEach(() => vi.clearAllMocks())

  it('renders empty state when no events received', () => {
    render(<MonitorPanel />)
    expect(screen.getByText(/no active tool calls/i)).toBeTruthy()
  })
})
