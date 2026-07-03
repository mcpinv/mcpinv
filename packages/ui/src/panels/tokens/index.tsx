import type { Panel } from '../../registry.js'

function TokensPanel() {
  return <div>Token Usage</div>
}

export const panel: Panel = {
  id: 'tokens',
  label: 'Token Usage',
  route: '/tokens',
  component: TokensPanel,
  order: 3
}
