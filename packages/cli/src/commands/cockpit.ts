import { Command } from 'commander'
import chalk from 'chalk'
import open from 'open'
import { CockpitServer } from '@mcpinv/bridge'

export function cockpitCommand(): Command {
  return new Command('cockpit')
    .alias('cp')
    .description('Start the mcpinv Cockpit hub and open it in the browser')
    .option('--port <number>', 'Cockpit port', (v) => parseInt(v, 10), 3000)
    .option('--host <host>', 'Bind host', 'localhost')
    .option('--db <path>', 'SQLite DB path (default: ~/.mcpinv/cockpit.db)')
    .action(async (opts: { port: number; host: string; db?: string }) => {
      const server = new CockpitServer({ port: opts.port, host: opts.host, dbPath: opts.db })
      try {
        await server.start()
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        if (!msg.includes('EADDRINUSE')) {
          console.error(chalk.red(`Failed to start Cockpit: ${msg}`))
          process.exit(1)
        }
        // EADDRINUSE = cockpit already running, just open browser
      }

      const url = `http://${opts.host === '0.0.0.0' ? 'localhost' : opts.host}:${opts.port}`
      console.log(chalk.green(`✓ Cockpit running on ${url}`))
      await open(url).catch(() => {
        console.log(chalk.dim(`  Open manually: ${url}`))
      })

      const shutdown = async () => { await server.stop(); process.exit(0) }
      process.on('SIGINT', shutdown)
      process.on('SIGTERM', shutdown)
      // Keep process alive
      setTimeout(() => {}, 2 ** 31 - 1)
    })
}
