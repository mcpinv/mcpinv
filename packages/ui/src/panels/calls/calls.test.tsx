import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { panel } from './index.js'
import * as client from '../../api/client.js'

vi.mock('../../api/client.js')

const mockCall: client.ToolCall = {
  id: 1,
  ts: Date.now(),
  server_id: 'srv',
  tool_name: 'read_file',
  duration_ms: 123,
  input_tokens: null,
  output_tokens: null,
  success: 1,
  error_msg: null
}

beforeEach(() => {
  vi.mocked(client.getCalls).mockResolvedValue([mockCall])
  vi.mocked(client.subscribeEvents).mockReturnValue(() => {})
})

describe('Call Log panel', () => {
  it('has correct panel metadata', () => {
    expect(panel.id).toBe('calls')
    expect(panel.label).toBe('Call Log')
    expect(panel.order).toBe(2)
    expect(panel.route).toBe('/calls')
  })

  it('renders tool call rows', async () => {
    render(<MemoryRouter><panel.component /></MemoryRouter>)
    await waitFor(() => screen.getByText('read_file'))
    expect(screen.getByText('123ms')).toBeTruthy()
  })

  it('shows ok badge for successful calls', async () => {
    render(<MemoryRouter><panel.component /></MemoryRouter>)
    await waitFor(() => screen.getByText('ok'))
  })

  it('shows error badge for failed calls', async () => {
    vi.mocked(client.getCalls).mockResolvedValue([
      { ...mockCall, success: 0, error_msg: 'ENOENT' }
    ])
    render(<MemoryRouter><panel.component /></MemoryRouter>)
    await waitFor(() => screen.getByText('error'))
  })

  it('shows empty state when no calls', async () => {
    vi.mocked(client.getCalls).mockResolvedValue([])
    render(<MemoryRouter><panel.component /></MemoryRouter>)
    await waitFor(() => screen.getByText(/No tool calls/))
  })
})
