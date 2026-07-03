import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { panel } from './index.js'
import * as client from '../../api/client.js'

vi.mock('../../api/client.js')

const mockSummary: client.TokenSummary = {
  total_calls: 47,
  total_input_tokens: null,
  total_output_tokens: null,
  top_tool: { name: 'search_code', calls: 23 }
}

const mockDaily: client.DailyBucket[] = [
  { date: '2026-07-01', calls: 12, input_tokens: null },
  { date: '2026-07-02', calls: 35, input_tokens: null }
]

beforeEach(() => {
  vi.mocked(client.getTokenSummary).mockResolvedValue(mockSummary)
  vi.mocked(client.getTokensDaily).mockResolvedValue(mockDaily)
})

describe('Token Usage panel', () => {
  it('has correct panel metadata', () => {
    expect(panel.id).toBe('tokens')
    expect(panel.label).toBe('Token Usage')
    expect(panel.order).toBe(3)
    expect(panel.route).toBe('/tokens')
  })

  it('shows total call count', async () => {
    render(<MemoryRouter><panel.component /></MemoryRouter>)
    await waitFor(() => screen.getByText('47'))
  })

  it('shows top tool name', async () => {
    render(<MemoryRouter><panel.component /></MemoryRouter>)
    await waitFor(() => screen.getByText('search_code'))
  })

  it('shows dash for null token counts', async () => {
    render(<MemoryRouter><panel.component /></MemoryRouter>)
    await waitFor(() => screen.getAllByText('—'))
  })

  it('shows error state on fetch failure', async () => {
    vi.mocked(client.getTokenSummary).mockRejectedValue(new Error('API down'))
    render(<MemoryRouter><panel.component /></MemoryRouter>)
    await waitFor(() => screen.getByText(/API down/))
  })
})
