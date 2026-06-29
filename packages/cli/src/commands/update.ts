import { Command } from 'commander'
import chalk from 'chalk'
import ora from 'ora'
import { listInstalled } from '../services/config-manager.js'
import { fetchManifest } from '../services/smithery.js'

export function updateCommand(): Command {
  return new Command('update')
    .description('Check for updates to installed MCP servers')
    .action(async () => {
      const servers = await listInstalled()
      if (servers.length === 0) {
        console.log(chalk.yellow('No servers installed.'))
        return
      }
      console.log(chalk.bold('\nChecking for updates...\n'))
      for (const id of servers) {
        const spinner = ora(id).start()
        try {
          const manifest = await fetchManifest(id)
          spinner.succeed(`${id} — latest: v${manifest.version}`)
        } catch {
          spinner.warn(`${id} — could not fetch latest version`)
        }
      }
      console.log()
    })
}
