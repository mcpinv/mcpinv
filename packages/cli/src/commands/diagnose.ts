import { Command } from 'commander'
import chalk from 'chalk'
import inquirer from 'inquirer'
import { createHash } from 'crypto'
import { collectContext, analyzeLocally, lookupError, reportError, runAssistant } from '@mcpinv/bridge'

export function diagnoseCommand(): Command {
  return new Command('diagnose')
    .description('Diagnose a failing MCP server with AI-guided assistance')
    .argument('<server-id>', 'ID of the MCP server to diagnose')
    .option('--stderr <text>', 'Stderr output from the failed server (for scripted use)')
    .option('--exit-code <number>', 'Exit code from the failed server', parseInt)
    .option('--no-telemetry', 'Disable error DB lookup and AI assistance')
    .action(async (serverId: string, opts: { stderr?: string; exitCode?: number; telemetry: boolean }) => {
      const stderr = opts.stderr ?? ''
      const exitCode = opts.exitCode ?? null

      console.log(chalk.red(`\n✗ Diagnosing: ${serverId}`))
      if (stderr) console.log(chalk.dim(`  stderr: ${stderr.slice(0, 120)}`))

      const ctx = await collectContext(serverId, exitCode, stderr, process.cwd())

      // Tier 1: local pattern match (offline)
      const local = analyzeLocally(ctx)
      if (local) {
        console.log(chalk.yellow(`\n  Likely cause: ${local.cause}`))
        console.log(chalk.green(`  Fix: ${local.suggestion}\n`))
        return
      }

      if (!opts.telemetry) {
        console.log(chalk.dim('  No local match found. Telemetry disabled — run without --no-telemetry for community lookup.'))
        return
      }

      // Tier 2: community error DB lookup
      const sig = createHash('sha256').update(stderr.slice(0, 512)).digest('hex').slice(0, 16)
      const guide = await lookupError(sig)
      if (guide) {
        const platform = ctx.os as 'windows' | 'macos' | 'linux'
        const fixes = guide.fixes[platform] ?? guide.fixes.linux
        console.log(chalk.yellow(`\n  Community fix (${ctx.os}):`))
        fixes.forEach((step: string) => console.log(`  $ ${step}`))
        console.log()
        return
      }

      // Tier 3: AI assistant
      const { action } = await inquirer.prompt([{
        type: 'list',
        name: 'action',
        message: 'No match found. What would you like to do?',
        choices: [
          { name: 'Start interactive diagnosis (AI-guided)', value: 'ai' },
          { name: 'Share error + request fix suggestion', value: 'share' },
          { name: 'Cancel', value: 'cancel' }
        ]
      }])

      if (action === 'cancel') return

      if (action === 'share') {
        await reportError(ctx)
        console.log(chalk.green('\n  Error reported. Thank you — it helps the community!'))
        return
      }

      console.log(chalk.bold('\n────────────────────────────────────────'))
      console.log(chalk.bold('  mcpinv Diagnosis Assistant'))
      console.log(chalk.bold('────────────────────────────────────────\n'))

      let fix = ''
      try {
        const result = await runAssistant(ctx, (chunk) => process.stdout.write(chunk))
        fix = result.fix
      } catch {
        console.log(chalk.red('\n  Could not reach AI assistant. Check your connection.'))
        return
      }

      if (!fix) return

      const { share } = await inquirer.prompt([{
        type: 'confirm',
        name: 'share',
        message: '\nSave this fix as a community guide?',
        default: true
      }])

      if (share) {
        await reportError(ctx)
        console.log(chalk.green('  Shared anonymously. Thank you!'))
      }
    })
}
