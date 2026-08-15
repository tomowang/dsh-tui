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
  { command: '/model', description: 'Manage LLM provider profiles' },
  { command: '/trajectory', description: 'Browse the turn/step event ledger' },
  { command: '/status', description: 'Show session status' },
  { command: '/clear', description: 'Clear the screen and start a new session' },
  { command: '/exit', description: 'Exit dsh-tui' },
  { command: '/quit', description: 'Exit dsh-tui' },
]

export function matchSlashCommands(query: string): readonly SlashCommand[] {
  return SLASH_COMMANDS.filter(c => c.command.startsWith(query))
}

export function commandQuery(value: string): { isCommandMode: boolean; matches: readonly SlashCommand[] } {
  // A trailing space (but no *internal* whitespace) still counts as command
  // mode, so `"/status "` behaves like `value.trim() === '/status'`.
  const query = value.trim()
  const isCommandMode = value.startsWith('/') && !/\s/.test(query)
  return { isCommandMode, matches: isCommandMode ? matchSlashCommands(query) : [] }
}

export function runSlashCommand(command: string, actions: TuiActions): void {
  switch (command) {
    case '/exit':
    case '/quit':
      actions.shutdown()
      return
    case '/status':
      actions.status()
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
  }
}
