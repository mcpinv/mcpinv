import axios from 'axios'
import type { DiagnosisContext, ErrorGuide } from '../types.js'

const API_BASE = 'https://api.mcpinv.dev'

export interface AssistantResult {
  fix: string
  guide: Omit<ErrorGuide, 'error_sig' | 'contributed_by' | 'verified'> | null
}

export async function runAssistant(
  ctx: DiagnosisContext,
  onChunk: (text: string) => void
): Promise<AssistantResult> {
  const response = await axios.post(
    `${API_BASE}/diagnose`,
    {
      server_id: ctx.serverId,
      exit_code: ctx.exitCode,
      stderr: ctx.stderr.slice(0, 512),
      os: ctx.os,
      node_version: ctx.nodeVersion,
      has_node_modules: ctx.hasNodeModules
    },
    {
      responseType: 'stream',
      timeout: 30000
    }
  )

  let fullText = ''
  for await (const chunk of response.data) {
    const text = (chunk as Buffer).toString()
    fullText += text
    onChunk(text)
  }

  return { fix: fullText, guide: null }
}
