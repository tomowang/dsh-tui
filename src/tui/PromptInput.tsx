/**
 * The reader's line of input: free text steers/follows up the agent, and a
 * small set of terminal-only commands control the session. Ctrl+C cancels a
 * running turn or exits when idle — the raw-mode replacement for the
 * readline-based SIGINT handling this component displaces.
 * @module @tomowang/dsh-tui/tui/PromptInput
 */

import { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'
import type { AgentStatus } from '@deepseek-ai/dsh-agent'
import { matchSlashCommands, runSlashCommand } from './commands.js'
import type { ProviderDraft, ProviderRow } from './modelProfile/types.js'

export interface TuiActions {
  /** Route free text to steering (running) or follow-up (idle). */
  send(text: string): void
  /** Cancel the active turn. */
  cancel(): void
  /** Flush and exit. */
  shutdown(): void
  /** Publish a transient `/status` snapshot as the live-region notice. */
  status(): void

  /** Open the `/model` provider-profile overlay and start loading providers. */
  openModelProfile(): void
  /** Close the `/model` overlay, discarding any in-progress edit. */
  closeModelProfile(): void
  /** Return from the add/edit form to the provider list without saving. */
  backToProviderList(): void
  /** Move the provider list's selection cursor. */
  selectProvider(index: number): void
  /** Open a blank draft for a new custom provider. */
  createProvider(): void
  /** Open an existing provider's stored profile for editing. */
  editProvider(route: string): void
  /** Persist a draft via `ctx.settings`/`ctx.credentials`, then reload the list. */
  saveProvider(draft: ProviderDraft): void
  /** Remove a provider's settings section and credential. */
  deleteProvider(row: ProviderRow): void
  /** Probe a draft's endpoint via `ctx.llm.discoverModels`. */
  discoverModelsForDraft(draft: ProviderDraft): void
  /** Save `{provider, model}` as the Agent's default model selection. */
  setActiveModel(provider: string, model: string): void
}

export interface PromptInputProps {
  readonly status: AgentStatus
  readonly actions: TuiActions
  readonly onCommandMatchesChange?: (count: number) => void
}

export function PromptInput({ status, actions, onCommandMatchesChange }: PromptInputProps) {
  const [value, setValue] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)

  // A trailing space (but no *internal* whitespace) still counts as command
  // mode, so `"/status "` behaves like the old `raw.trim() === '/status'`.
  const query = value.trim()
  const isCommandMode = value.startsWith('/') && !/\s/.test(query)
  const matches = isCommandMode ? matchSlashCommands(query) : []
  const selected = matches.length === 0 ? 0 : Math.min(selectedIndex, matches.length - 1)

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      if (status === 'running') actions.cancel()
      else actions.shutdown()
      return
    }
    if (isCommandMode && matches.length > 0) {
      if (key.upArrow) {
        setSelectedIndex(i => (i - 1 + matches.length) % matches.length)
        return
      }
      if (key.downArrow) {
        setSelectedIndex(i => (i + 1) % matches.length)
        return
      }
    }
  })

  function handleValueChange(next: string): void {
    setValue(next)
    const nextQuery = next.trim()
    const nextCommandMode = next.startsWith('/') && !/\s/.test(nextQuery)
    const nextMatches = nextCommandMode ? matchSlashCommands(nextQuery) : []
    onCommandMatchesChange?.(nextMatches.length)
  }

  function handleSubmit(raw: string): void {
    setValue('')
    setSelectedIndex(0)
    onCommandMatchesChange?.(0)
    const trimmed = raw.trim()
    if (trimmed === '') return
    const commandMatches = trimmed.startsWith('/') && !/\s/.test(trimmed) ? matchSlashCommands(trimmed) : []
    if (commandMatches.length > 0) {
      const chosen = commandMatches[Math.min(selectedIndex, commandMatches.length - 1)]
      runSlashCommand(chosen.command, actions)
      return
    }
    actions.send(trimmed)
  }

  return (
    <Box flexDirection="column">
      {isCommandMode && matches.length > 0 && (
        <Box flexDirection="column" paddingX={1}>
          {matches.map((cmd, i) => (
            <Text key={cmd.command} inverse={i === selected}>
              {cmd.command.padEnd(10)} {cmd.description}
            </Text>
          ))}
        </Box>
      )}
      <Box borderStyle="round" borderColor="white" paddingX={1}>
        <Text>{'› '}</Text>
        <TextInput value={value} onChange={handleValueChange} onSubmit={handleSubmit} />
      </Box>
    </Box>
  )
}
