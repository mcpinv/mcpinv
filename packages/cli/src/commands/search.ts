import { Command } from 'commander'
import chalk from 'chalk'
import ora from 'ora'
import { searchServers } from '../services/smithery.js'

export function searchCommand(): Command {
  return new Command('search')
    .description('Search for MCP servers')
    .argument('<query>', 'Search term')
    .action(async (query: string) => {
      const spinner = ora(`Searching for "${query}"...`).start()
      try {
        const results = await searchServers(query)
        spinner.stop()
        if (results.length === 0) {
          console.log(chalk.yellow('No servers found.'))
          return
        }
        console.log(chalk.bold(`\n${results.length} server(s) found:\n`))
        for (const s of results) {
          console.log(`  ${chalk.cyan(s.id)}`)
          console.log(`  ${chalk.dim(s.description)}`)
          console.log(`  ${chalk.green(`mcpinv install ${s.id}`)}\n`)
        }
      } catch (err) {
        spinner.fail('Search failed')
        console.error(chalk.red(String(err)))
        process.exit(1)
      }
    })
}
