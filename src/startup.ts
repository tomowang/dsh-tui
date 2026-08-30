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
  /**
   * Session id to resume; `undefined` starts a fresh session; `true` is
   * `--resume` given with no id, which opens the session picker instead of
   * resuming a specific one.
   */
  resume: string | true | undefined
  /** Agent preset id to compose a fresh session from; `undefined` uses the deployment's default. Ignored when resuming. */
  agentPreset: string | undefined
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
    .option('--resume [sessionId]', 'resume a persisted session by id; with no id, opens a picker of past sessions')
    .option('--agent-preset <id>', 'select an agent preset for a fresh session (e.g. standard, code, minimal, cordis)')
    .addHelpText('after', `
Examples:
  dsh --profile tui                          start a fresh interactive session
  dsh --profile tui --resume <sessionId>     reopen a persisted session
  dsh --profile tui --resume                 pick a past session from a list
  dsh --profile tui --agent-preset code      start a fresh session on the "code" preset
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
    // Commander's own quirk for an optional-value option (`[sessionId]`):
    // absent entirely -> `undefined`; given bare (`--resume`) -> `true`;
    // given with a value -> that string.
    const options = program.opts<{ resume?: string | true; agentPreset?: string }>()
    ctx.provide(TUI_STARTUP_SERVICE, { resume: options.resume, agentPreset: options.agentPreset } satisfies TuiStartupValues)
  })
  parseCmdline(ctx, program)
}
