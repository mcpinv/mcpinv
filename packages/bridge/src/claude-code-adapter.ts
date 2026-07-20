import { createHash, randomUUID } from 'crypto'
import { readFileSync } from 'fs'
import type Database from 'better-sqlite3'
import {
  upsertSession, upsertRoundtrip, insertAnalyticsToolCall,
  getFileHash, deleteSession
} from './analytics-db.js'
import type { IngestResult, SessionAdapter } from './types.js'

export type { IngestResult }

const WRITE_TOOL_RE = /\b(write|edit|create|delete|bash|execute|git)\b/i

interface RawLine {
  type: string
  message?: {
    content?: unknown
    usage?: { input_tokens?: number; output_tokens?: number }
  }
  timestamp?: string
  requestId?: string
  name?: string
  duration_ms?: number
  is_error?: boolean
}

export class ClaudeCodeAdapter implements SessionAdapter {
  readonly provider = 'claude-code'

  constructor(private readonly db: Database.Database) {}

  async ingest(filePath: string): Promise<IngestResult> {
    const content = readFileSync(filePath, 'utf8')
    const hash = createHash('sha256').update(content).digest('hex')

    const storedHash = getFileHash(this.db, filePath)
    if (storedHash === hash) {
      return { sessionId: '', roundtripsWritten: 0, toolCallsWritten: 0, skipped: true }
    }

    const lines: RawLine[] = content
      .split('\n')
      .filter(l => l.trim())
      .map(l => { try { return JSON.parse(l) } catch { return null } })
      .filter(Boolean)

    // Group lines into roundtrips: each group starts with a 'user' entry
    const groups: RawLine[][] = []
    for (const line of lines) {
      if (line.type === 'user') {
        groups.push([line])
      } else if (groups.length > 0) {
        groups[groups.length - 1].push(line)
      }
    }

    if (groups.length === 0) {
      return { sessionId: '', roundtripsWritten: 0, toolCallsWritten: 0, skipped: false }
    }

    const firstTs = groups[0][0].timestamp ? new Date(groups[0][0].timestamp).getTime() : null
    const lastGroup = groups[groups.length - 1]
    const lastLine = lastGroup[lastGroup.length - 1]
    const lastTs = lastLine.timestamp ? new Date(lastLine.timestamp).getTime() : null

    const sessionId = createHash('sha256').update(filePath + (firstTs ?? '')).digest('hex').slice(0, 16)

    // If file changed, remove stale records before re-ingesting
    if (storedHash !== null) {
      deleteSession(this.db, sessionId)
    }

    upsertSession(this.db, {
      id: sessionId,
      provider: 'claude-code',
      source_path: filePath,
      file_hash: hash,
      started_at: firstTs,
      ended_at: lastTs
    })

    // First pass: collect raw roundtrip data for significance scoring
    const rawRoundtrips = groups.map((group, i) => {
      // Deduplicate assistant lines by requestId (thinking + text entries share the same requestId)
      const seenRequestIds = new Set<string>()
      const uniqueAssistantLines = group.filter(l => {
        if (l.type !== 'assistant') return false
        if (!l.requestId) return true
        if (seenRequestIds.has(l.requestId)) return false
        seenRequestIds.add(l.requestId)
        return true
      })
      // Tokens live at entry.message.usage, not entry.usage
      const assistantLine = uniqueAssistantLines[uniqueAssistantLines.length - 1]
      const humanTokens = assistantLine?.message?.usage?.input_tokens ?? null
      const assistantTokens = assistantLine?.message?.usage?.output_tokens ?? null
      const toolUses = group.filter(l => l.type === 'tool_use')
      const toolResults = group.filter(l => l.type === 'tool_result')
      const startTs = group[0].timestamp ? new Date(group[0].timestamp).getTime() : null
      const lastLineTs = group[group.length - 1].timestamp
        ? new Date(group[group.length - 1].timestamp!).getTime()
        : null
      const durationMs = startTs && lastLineTs ? lastLineTs - startTs : null

      return { i, humanTokens, assistantTokens, toolUses, toolResults, startTs, durationMs }
    })

    // Compute 75th-percentile threshold for assistant_tokens within this session
    const tokenValues = rawRoundtrips
      .map(r => r.assistantTokens)
      .filter((v): v is number => v !== null)
      .sort((a, b) => a - b)
    const q75 = tokenValues.length > 1
      ? tokenValues[Math.floor(tokenValues.length * 0.75)]
      : null

    let toolCallsWritten = 0

    for (const r of rawRoundtrips) {
      const roundtripId = `${sessionId}-${r.i}`
      let score = 0
      if (r.toolUses.some(t => t.name && WRITE_TOOL_RE.test(t.name))) score++
      if (r.toolUses.length >= 3) score++
      if (q75 !== null && r.assistantTokens !== null && r.assistantTokens >= q75) score++

      upsertRoundtrip(this.db, {
        id: roundtripId,
        session_id: sessionId,
        sequence_nr: r.i + 1,
        human_tokens: r.humanTokens,
        assistant_tokens: r.assistantTokens,
        tool_call_count: r.toolUses.length,
        significance_score: Math.min(score, 3),
        started_at: r.startTs,
        duration_ms: r.durationMs
      })

      for (let j = 0; j < r.toolUses.length; j++) {
        const toolUse = r.toolUses[j]
        const toolResult = r.toolResults[j]
        insertAnalyticsToolCall(this.db, {
          id: randomUUID(),
          roundtrip_id: roundtripId,
          tool_name: toolUse.name ?? 'unknown',
          duration_ms: toolResult?.duration_ms ?? null,
          success: toolResult == null ? null : toolResult.is_error ? 0 : 1
        })
        toolCallsWritten++
      }
    }

    return { sessionId, roundtripsWritten: groups.length, toolCallsWritten, skipped: false }
  }
}
