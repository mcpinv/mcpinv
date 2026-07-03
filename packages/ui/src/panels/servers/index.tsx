import type { Panel } from '../../registry.js'

function ServersPanel() {
  return <div>Servers</div>
}

export const panel: Panel = {
  id: 'servers',
  label: 'Servers',
  route: '/servers',
  component: ServersPanel,
  order: 1
}
