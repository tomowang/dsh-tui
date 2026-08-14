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
  { command: '/status', description: 'Show session status' },
  { command: '/exit', description: 'Exit dsh-tui' },
  { command: '/quit', description: 'Exit dsh-tui' },
]

export function matchSlashCommands(query: string): readonly SlashCommand[] {
  return SLASH_COMMANDS.filter(c => c.command.startsWith(query))
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
    case '/model':
      actions.openModelProfile()
      return
  }
}
