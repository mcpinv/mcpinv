export interface McpServer {
  id: string
  name: string
  description: string
  version: string
  runtime: 'node' | 'python' | 'binary'
  secrets: SecretSpec[]
  installCommand: string
  args: string[]
  source: 'smithery'
}

export interface SecretSpec {
  key: string
  description: string
  required: boolean
}

export interface InstalledServer {
  id: string
  name: string
  version: string
  installedAt: string
  remoteUrl?: string
}

export interface ClientConfig {
  claude: string | null
  cursor: string | null
  cline: string | null
}
