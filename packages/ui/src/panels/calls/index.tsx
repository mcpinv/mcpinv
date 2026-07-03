import type { Panel } from '../../registry.js'

function CallsPanel() {
  return <div>Call Log</div>
}

export const panel: Panel = {
  id: 'calls',
  label: 'Call Log',
  route: '/calls',
  component: CallsPanel,
  order: 2
}
