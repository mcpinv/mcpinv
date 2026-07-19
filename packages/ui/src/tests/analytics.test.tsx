import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AnalyticsPanel } from '../panels/analytics/index.js'

vi.mock('../api/client.js', () => ({
  getSessions: vi.fn().mockResolvedValue([]),
  getRoundtrips: vi.fn().mockResolvedValue([]),
}))

describe('AnalyticsPanel', () => {
  afterEach(() => vi.clearAllMocks())

  it('renders empty state when no sessions', async () => {
    render(<AnalyticsPanel />)
    await screen.findByText(/no sessions collected yet/i)
  })
})
