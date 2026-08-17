/**
 * Terminal-only commands the prompt intercepts before text reaches the
 * agent. Data-driven so `PromptInput` can both dispatch on submit and render
 * a filtered picker while the reader is still typing.
 * @module @tomowang/dsh-tui/tui/commands
 */

import type { TuiActions } from './PromptInput.js'

export interface SlashCommand {
  readonly command: string
  readonly description: string
}

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { command: '/help', description: 'Show help and available commands' },
  { command: '/model', description: 'Manage LLM provider profiles' },
  { command: '/trajectory', description: 'Browse the turn/step event ledger' },
  { command: '/context', description: 'Show context window usage' },
  { command: '/plugins', description: 'Show the loaded plugin tree' },
  { command: '/presets', description: 'Show and switch agent presets (only while the session is blank)' },
  { command: '/compact', description: 'Summarize and compact session history' },
  { command: '/clear', description: 'Clear the screen and start a new session' },
  { command: '/exit', description: 'Exit dsh-tui' },
  { command: '/quit', description: 'Exit dsh-tui' },
]

/** Widest command text, so the dropdown can pad every row's description to the same column. */
export const SLASH_COMMAND_WIDTH = Math.max(...SLASH_COMMANDS.map(c => c.command.length))

export function matchSlashCommands(query: string): readonly SlashCommand[] {
  return SLASH_COMMANDS.filter(c => c.command.startsWith(query))
}

export function commandQuery(value: string): { isCommandMode: boolean; matches: readonly SlashCommand[] } {
  // A trailing space (but no *internal* whitespace) still counts as command
  // mode, so `"/clear "` behaves like `value.trim() === '/clear'`.
  const query = value.trim()
  const isCommandMode = value.startsWith('/') && !/\s/.test(query)
  return { isCommandMode, matches: isCommandMode ? matchSlashCommands(query) : [] }
}

export function runSlashCommand(command: string, actions: TuiActions): void {
  switch (command) {
    case '/help':
      actions.help()
      return
    case '/exit':
    case '/quit':
      actions.shutdown()
      return
    case '/clear':
      actions.clear()
      return
    case '/model':
      actions.openModelProfile()
      return
    case '/trajectory':
      actions.openTrajectory()
      return
    case '/context':
      actions.openContext()
      return
    case '/plugins':
      actions.openPlugins()
      return
    case '/presets':
      actions.openAgentPresets()
      return
    case '/compact':
      actions.compact()
      return
  }
}
