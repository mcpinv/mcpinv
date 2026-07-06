import { Command } from 'commander'
import chalk from 'chalk'
import { listInstalled } from '../services/config-manager.js'

export function importCommand(): Command {
  return new Command('import')
    .description('Discover MCP servers already configured in Claude Desktop / Cursor')
    .action(async () => {
      const ids = await listInstalled()

      if (ids.length === 0) {
        console.log(chalk.yellow('No MCP servers found in your config. Install one with: mcpinv install <id>'))
        return
      }

      console.log(chalk.bold(`\n${ids.length} server(s) found in your config:\n`))
      for (const id of ids) {
        console.log(`  ${chalk.cyan(id)}`)
        console.log(`  ${chalk.green(`mcpinv serve ${id}`)}\n`)
      }
    })
}
