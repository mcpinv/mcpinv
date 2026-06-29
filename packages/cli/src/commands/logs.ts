import { Command } from 'commander'
import chalk from 'chalk'
import os from 'os'
import path from 'path'
import fs from 'fs'

export function logsCommand(): Command {
  return new Command('logs')
    .description('Show logs for an installed MCP server')
    .argument('<server-id>', 'Server ID')
    .option('-n, --lines <number>', 'Number of lines', '50')
    .action(async (serverId: string, opts: { lines: string }) => {
      const logFile = path.join(os.homedir(), '.mcpinv', 'logs', `${serverId}.log`)
      if (!fs.existsSync(logFile)) {
        console.log(chalk.yellow(`No logs found for ${serverId}`))
        console.log(chalk.dim(`Log file expected at: ${logFile}`))
        return
      }
      const lines = parseInt(opts.lines, 10)
      const content = fs.readFileSync(logFile, 'utf-8').split('\n').slice(-lines).join('\n')
      console.log(chalk.dim(`--- last ${lines} lines: ${logFile} ---\n`))
      console.log(content)
    })
}
