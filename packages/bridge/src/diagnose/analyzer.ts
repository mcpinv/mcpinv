import type { DiagnosisContext, ErrorPattern } from '../types.js'

const PATTERNS: Array<{ match: RegExp; cause: string; suggestion: string }> = [
  {
    match: /ENOENT/,
    cause: 'binary_not_found',
    suggestion: 'Check the server path or re-run: mcpinv install <server-id>'
  },
  {
    match: /Cannot find module/,
    cause: 'missing_dependency',
    suggestion: 'Run npm install in the server directory, or re-run: mcpinv install <server-id>'
  },
  {
    match: /EADDRINUSE/,
    cause: 'port_in_use',
    suggestion: 'Another process is using this port. Try: mcpinv serve <server-id> --port 3001'
  },
  {
    match: /auth|unauthorized|401|403/i,
    cause: 'missing_secret',
    suggestion: 'A required secret may be missing. Run: mcpinv migrate'
  }
]

export function analyzeLocally(ctx: DiagnosisContext): ErrorPattern | null {
  for (const pattern of PATTERNS) {
    if (pattern.match.test(ctx.stderr)) {
      return { cause: pattern.cause, suggestion: pattern.suggestion }
    }
  }
  return null
}
