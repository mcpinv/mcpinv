import axios from 'axios'
import { createHash } from 'crypto'
import type { DiagnosisContext, ErrorGuide } from '../types.js'

const BASE = 'https://errors.mcpinv.dev'

function hashStderr(stderr: string): string {
  return createHash('sha256').update(stderr.slice(0, 512)).digest('hex').slice(0, 16)
}

export async function lookupError(sig: string): Promise<ErrorGuide | null> {
  try {
    const { data } = await axios.get(`${BASE}/lookup`, { params: { sig }, timeout: 5000 })
    return data.guide ?? null
  } catch {
    return null
  }
}

export async function reportError(ctx: DiagnosisContext): Promise<void> {
  try {
    await axios.post(`${BASE}/report`, {
      stderr: ctx.stderr.slice(0, 512),
      exit_code: ctx.exitCode,
      os: ctx.os,
      node_version: ctx.nodeVersion,
      has_node_modules: ctx.hasNodeModules,
      error_sig: hashStderr(ctx.stderr)
    }, { timeout: 5000 })
  } catch {}
}
