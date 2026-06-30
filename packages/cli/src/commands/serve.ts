import { Command } from 'commander'
import chalk from 'chalk'
import { homedir } from 'os'
import { join } from 'path'
import { mkdirSync } from 'fs'
import { getServerConfig, detectClients } from '../services/config-manager.js'
import { listSecrets, getSecret } from '../services/keychain.js'
import { McpClient, BridgeServer, ConfigWatcher } from '@mcpinv/bridge'

export function serveCommand(): Command {
  return new Command('serve')
    .description('Start a local REST bridge for an installed MCP server')
    .argument('<server-id>', 'ID of the installed MCP server')
    .option('--port <number>', 'HTTP port', (v) => parseInt(v, 10), 3000)
    .option('--host <host>', 'Bind host', 'localhost')
    .option('--no-watch', 'Disable hot-swap on config changes')
    .option('--no-telemetry', 'Disable error DB and AI diagnosis')
    .action(async (serverId: string, opts: { port: number; host: string; watch: boolean }) => {
      const serverConfig = await getServerConfig(serverId)
      if (!serverConfig) {
        console.error(chalk.red(`Server "${serverId}" not found. Run: mcpinv install ${serverId}`))
        process.exit(1)
      }

      if (opts.host === '0.0.0.0') {
        console.warn(chalk.yellow('Warning: binding to 0.0.0.0 exposes the bridge on your network'))
      }

      const secretKeys = await listSecrets(serverId)
      const env: Record<string, string> = {}
      for (const key of secretKeys) {
        const value = await getSecret(serverId, key)
        if (value) env[key] = value
      }

      const logDir = join(homedir(), '.mcpinv', 'logs')
      mkdirSync(logDir, { recursive: true })
      const logPath = join(logDir, `bridge-${serverId}.log`)

      const client = new McpClient({ command: serverConfig.command, args: serverConfig.args, env })
      await client.connect()

      const server = new BridgeServer(client, { serverId, port: opts.port, host: opts.host, logPath })
      await server.start()

      const tools = await client.listTools()
      console.log(chalk.green(`✓ MCP server started (${serverId})`))
      console.log(chalk.green(`✓ ${tools.length} tools discovered`))
      console.log(chalk.green(`✓ Bridge running on http://${opts.host}:${opts.port}`))
      console.log(`  OpenAPI spec:  http://${opts.host}:${opts.port}/openapi.json`)
      console.log(`  Tool list:     http://${opts.host}:${opts.port}/tools`)

      if (opts.watch) {
        const configPaths = await detectClients()
        const configPath = configPaths[0]
        if (configPath) {
          const watcher = new ConfigWatcher()
          watcher.watch(configPath, async () => {
            const refreshed = await client.listTools()
            server.updateTools(refreshed)
          })
          console.log(chalk.dim('  Watching for config changes... (--no-watch to disable)'))
        }
      }

      const shutdown = async () => {
        await server.stop()
        await client.close()
        process.exit(0)
      }

      process.on('SIGINT', shutdown)
      process.on('SIGTERM', shutdown)
      setTimeout(() => {}, 2 ** 31 - 1)
    })
}
