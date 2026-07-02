import { EventEmitter } from 'events'

export interface ToolCallEvent {
  id: number
  ts: number
  server_id: string
  tool_name: string
  duration_ms: number | null
  input_tokens: number | null
  output_tokens: number | null
  success: boolean
  error_msg: string | null
}

export type CockpitEvent =
  | { type: 'tool_call';    data: ToolCallEvent }
  | { type: 'server_up';   data: { ts: number; server_id: string } }
  | { type: 'server_down'; data: { ts: number; server_id: string } }
  | { type: 'server_error';data: { ts: number; server_id: string; message: string } }

export class EventBus extends EventEmitter {
  emit_event(event: CockpitEvent): void {
    this.emit('cockpit', event)
  }
  on_event(listener: (event: CockpitEvent) => void): void {
    this.on('cockpit', listener)
  }
  off_event(listener: (event: CockpitEvent) => void): void {
    this.off('cockpit', listener)
  }
}
