import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { panel } from './index.js'
import * as client from '../../api/client.js'

vi.mock('../../api/client.js')

const mockServer = {
  id: 'my-server',
  status: 'running' as const,
  uptime_ms: 65000,
  restart_count: 0,
  last_error: null
}

beforeEach(() => {
  vi.mocked(client.getServers).mockResolvedValue([mockServer])
  vi.mocked(client.subscribeEvents).mockReturnValue(() => {})
})

describe('Servers panel', () => {
  it('has correct panel metadata', () => {
    expect(panel.id).toBe('servers')
    expect(panel.label).toBe('Servers')
    expect(panel.order).toBe(1)
    expect(panel.route).toBe('/servers')
  })

  it('displays server id and status', async () => {
    render(<MemoryRouter><panel.component /></MemoryRouter>)
    await waitFor(() => screen.getByText('my-server'))
    expect(screen.getByText('running')).toBeTruthy()
  })

  it('shows uptime in human-readable format', async () => {
    render(<MemoryRouter><panel.component /></MemoryRouter>)
    await waitFor(() => screen.getByText('1m'))
  })

  it('shows error message when fetch fails', async () => {
    vi.mocked(client.getServers).mockRejectedValue(new Error('network down'))
    render(<MemoryRouter><panel.component /></MemoryRouter>)
    await waitFor(() => screen.getByText(/network down/))
  })
})
