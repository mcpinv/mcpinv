import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ServersPanel } from './index.js'
import * as client from '../../api/client.js'

vi.mock('../../api/client.js', () => ({
  getServers: vi.fn(),
  subscribeEvents: vi.fn(() => () => {}),
  startServer: vi.fn().mockResolvedValue(undefined),
  stopServer: vi.fn().mockResolvedValue(undefined)
}))

describe('ServersPanel', () => {
  beforeEach(() => {
    vi.mocked(client.getServers).mockResolvedValue([
      { id: 'my-server', status: 'stopped', uptime_ms: null, restart_count: 0, last_error: null, today_calls: 7 }
    ])
  })

  it('shows today_calls count', async () => {
    render(<ServersPanel />)
    expect(await screen.findByText('7')).toBeInTheDocument()
  })

  it('shows Start button for stopped server', async () => {
    render(<ServersPanel />)
    expect(await screen.findByRole('button', { name: /start/i })).toBeInTheDocument()
  })

  it('shows Stop button for running server', async () => {
    vi.mocked(client.getServers).mockResolvedValue([
      { id: 'my-server', status: 'running', uptime_ms: 5000, restart_count: 0, last_error: null, today_calls: 3 }
    ])
    render(<ServersPanel />)
    expect(await screen.findByRole('button', { name: /stop/i })).toBeInTheDocument()
  })

  it('calls startServer when Start button clicked', async () => {
    render(<ServersPanel />)
    fireEvent.click(await screen.findByRole('button', { name: /start/i }))
    await waitFor(() => expect(client.startServer).toHaveBeenCalledWith('my-server'))
  })

  it('calls stopServer when Stop button clicked', async () => {
    vi.mocked(client.getServers).mockResolvedValue([
      { id: 'running-srv', status: 'running', uptime_ms: 1000, restart_count: 0, last_error: null, today_calls: 0 }
    ])
    render(<ServersPanel />)
    fireEvent.click(await screen.findByRole('button', { name: /stop/i }))
    await waitFor(() => expect(client.stopServer).toHaveBeenCalledWith('running-srv'))
  })
})
