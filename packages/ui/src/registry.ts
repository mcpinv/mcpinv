import type { ComponentType } from 'react'

export interface Panel {
  id: string
  label: string
  route: string
  component: ComponentType
  badge?: () => number | null
  tier?: 'free' | 'pro'
  order?: number
}

import { panel as servers } from './panels/servers/index.js'
import { panel as calls }   from './panels/calls/index.js'
import { panel as tokens }  from './panels/tokens/index.js'
import { panel as monitor } from './panels/monitor/index.js'

export const panels: Panel[] = [servers, calls, tokens, monitor]
  .sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
