import { Command } from 'commander'
import chalk from 'chalk'
import inquirer from 'inquirer'
import { removeServer } from '../services/config-manager.js'
import { listSecrets, deleteSecret } from '../services/keychain.js'

export function removeCommand(): Command {
  return new Command('remove')
    .description('Uninstall an MCP server')
    .argument('<server-id>', 'Server to remove')
    .action(async (serverId: string) => {
      const { confirm } = await inquirer.prompt([{
        name: 'confirm', type: 'confirm',
        message: `Remove ${serverId} and its stored secrets?`,
        default: false
      }])
      if (!confirm) return

      await removeServer(serverId)
      const secrets = await listSecrets(serverId)
      for (const key of secrets) await deleteSecret(serverId, key)

      console.log(chalk.green(`✓ ${serverId} removed`))
      console.log(chalk.dim('  Restart Claude Desktop / Cursor to deactivate\n'))
    })
}
