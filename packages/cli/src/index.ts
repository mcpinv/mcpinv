#!/usr/bin/env node
import { createRequire } from 'module'
import { program } from 'commander'

const require = createRequire(import.meta.url)
const { version } = require('../package.json')
import { searchCommand } from './commands/search.js'
import { installCommand } from './commands/install.js'
import { removeCommand } from './commands/remove.js'
import { statusCommand } from './commands/status.js'
import { logsCommand } from './commands/logs.js'
import { updateCommand } from './commands/update.js'
import { migrateCommand } from './commands/migrate.js'
import { serveCommand } from './commands/serve.js'
import { diagnoseCommand } from './commands/diagnose.js'
import { importCommand } from './commands/import.js'
import { cockpitCommand } from './commands/cockpit.js'

program
  .name('mcpinv')
  .description('Install, run and host MCP servers')
  .version(version)

program.addCommand(searchCommand())
program.addCommand(installCommand())
program.addCommand(removeCommand())
program.addCommand(statusCommand())
program.addCommand(logsCommand())
program.addCommand(updateCommand())
program.addCommand(migrateCommand())
program.addCommand(serveCommand())
program.addCommand(diagnoseCommand())
program.addCommand(importCommand())
program.addCommand(cockpitCommand())

program.parse()
