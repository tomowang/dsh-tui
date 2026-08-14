/**
 * The TUI app's command-line provider: it parses this app's flags and
 * publishes {@link TUI_STARTUP_SERVICE}. The interactive runner is an
 * ordinary consumer whose lazy config waits for that service.
 * @module @tomowang/dsh-tui/startup
 */

import { Command } from 'commander'
import type { Context } from '@deepseek-ai/cordis'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'

/** Stable Cordis plugin name. */
export const name = 'tui-startup'

/** Services required before the startup values can be resolved. */
export const inject = ['cmdlineArgs']

/** Service provided by this plugin and injected by the interactive runner. */
export const TUI_STARTUP_SERVICE = 'tuiStartup'

/** What the runner row reads from {@link TUI_STARTUP_SERVICE}. */
export interface TuiStartupValues {
  /** Session id to resume; `undefined` starts a fresh session. */
  resume: string | undefined
}

/**
 * This app's command: the resume flag, its description, and its help text.
 * @returns a fresh program, so one process can parse more than once (tests).
 */
function tuiCommand(): Command {
  return new Command()
    .name('dsh --profile tui')
    .description('Interactive terminal session over the dsh agent.')
    .helpOption('-h, --help', 'show this help')
    .option('--resume <sessionId>', 'resume a persisted session by id')
    .addHelpText('after', `
Examples:
  dsh --profile tui                          start a fresh interactive session
  dsh --profile tui --resume <sessionId>     reopen a persisted session
`)
}

/**
 * Parse and provide the TUI startup values as an ordinary Cordis service.
 * The command's action publishes the values; on rejection (and on `--help`)
 * nothing is provided, so the runner never mounts.
 * @param ctx - plugin context carrying the command line.
 */
export function apply(ctx: Context): void {
  const program = tuiCommand()
  program.action(() => {
    const options = program.opts<{ resume?: string }>()
    ctx.provide(TUI_STARTUP_SERVICE, { resume: options.resume } satisfies TuiStartupValues)
  })
  parseCmdline(ctx, program)
}
