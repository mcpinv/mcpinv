import { Command } from 'commander'
import chalk from 'chalk'
import ora from 'ora'
import inquirer from 'inquirer'
import { fetchManifest } from '../services/smithery.js'
import { setSecret, getSecret } from '../services/keychain.js'
import { addServer } from '../services/config-manager.js'

export function installCommand(): Command {
  return new Command('install')
    .description('Install an MCP server')
    .argument('<server-id>', 'Server ID from inv search')
    .action(async (serverId: string) => {
      const spinner = ora(`Fetching manifest for ${serverId}...`).start()
      let manifest
      try {
        manifest = await fetchManifest(serverId)
        spinner.succeed(`Found: ${manifest.name} v${manifest.version}`)
      } catch {
        spinner.fail(`Server "${serverId}" not found`)
        process.exit(1)
      }

      const env: Record<string, string> = {}
      for (const secret of manifest.secrets) {
        const existing = await getSecret(serverId, secret.key)
        if (existing) {
          console.log(chalk.dim(`  ${secret.key}: using stored value`))
          env[secret.key] = `keychain://mcpinv/${serverId}:${secret.key}`
          continue
        }
        if (!secret.required) continue
        const answer = await inquirer.prompt([{
          name: secret.key,
          type: 'password',
          message: `${secret.description || secret.key}:`,
          mask: '*'
        }])
        await setSecret(serverId, secret.key, answer[secret.key])
        env[secret.key] = `keychain://mcpinv/${serverId}:${secret.key}`
      }

      const injectSpinner = ora('Updating client configs...').start()
      await addServer(serverId, {
        command: manifest.installCommand,
        args: manifest.args,
        env
      })
      injectSpinner.succeed('Done!')

      console.log(chalk.green(`\n✓ ${manifest.name} installed`))
      console.log(chalk.dim('  Restart Claude Desktop / Cursor to activate\n'))
    })
}
