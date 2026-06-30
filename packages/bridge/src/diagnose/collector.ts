import { existsSync } from 'fs'
import { join } from 'path'
import { platform, version as nodeVersion } from 'process'
import type { DiagnosisContext } from '../types.js'

const OS_MAP: Record<string, string> = { win32: 'win32', darwin: 'darwin', linux: 'linux' }

export async function collectContext(
  serverId: string,
  exitCode: number | null,
  stderr: string,
  serverPath: string
): Promise<DiagnosisContext> {
  return {
    serverId,
    exitCode,
    stderr,
    os: OS_MAP[platform] ?? platform,
    nodeVersion: nodeVersion.replace(/^v/, ''),
    hasNodeModules: existsSync(join(serverPath, 'node_modules'))
  }
}
