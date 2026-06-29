import { Command } from 'commander'
import chalk from 'chalk'
import { listInstalled } from '../services/config-manager.js'

export function statusCommand(): Command {
  return new Command('status')
    .description('Show installed MCP servers')
    .action(async () => {
      const servers = await listInstalled()
      if (servers.length === 0) {
        console.log(chalk.yellow('No servers installed. Run: inv search <query>'))
        return
      }
      console.log(chalk.bold(`\nInstalled servers (${servers.length}):\n`))
      for (const id of servers) {
        console.log(`  ${chalk.cyan('●')} ${id}`)
      }
      console.log()
    })
}
