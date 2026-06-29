import { Command } from 'commander'
import chalk from 'chalk'
import inquirer from 'inquirer'
import { hasPlaintextSecrets } from '../services/config-manager.js'
import { setSecret } from '../services/keychain.js'

export function migrateCommand(): Command {
  return new Command('migrate')
    .description('Move plaintext secrets from config files into the OS Keychain')
    .action(async () => {
      const found = await hasPlaintextSecrets()
      if (found.length === 0) {
        console.log(chalk.green('✓ No plaintext secrets found — you are already secure!'))
        return
      }

      console.log(chalk.yellow(`\nFound ${found.length} plaintext secret(s) in your config:\n`))
      for (const s of found) {
        console.log(`  ${chalk.cyan(s.serverId)} → ${s.key}: ${chalk.red(s.value.slice(0, 8) + '...')}`)
      }

      const { confirm } = await inquirer.prompt([{
        name: 'confirm', type: 'confirm',
        message: 'Move all to OS Keychain and remove from config?',
        default: true
      }])
      if (!confirm) return

      for (const s of found) {
        await setSecret(s.serverId, s.key, s.value)
        console.log(chalk.green(`  ✓ ${s.serverId}:${s.key} → Keychain`))
      }

      console.log(chalk.green('\n✓ Migration complete. Restart your AI clients to apply.\n'))
    })
}
