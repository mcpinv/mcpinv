import { Command } from 'commander'
import chalk from 'chalk'
import open from 'open'

export function cockpitCommand(): Command {
  return new Command('cockpit')
    .alias('cp')
    .description('Open the mcpinv Cockpit UI in the browser')
    .option('--port <number>', 'Bridge port', (v) => parseInt(v, 10), 3000)
    .option('--host <host>', 'Bridge host', 'localhost')
    .action(async (opts: { port: number; host: string }) => {
      const url = `http://${opts.host}:${opts.port}`
      console.log(chalk.dim(`Opening ${url} ...`))
      await open(url).catch(() => {
        console.error(chalk.red(`Could not open browser. Visit: ${url}`))
      })
    })
}
