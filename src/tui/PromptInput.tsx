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
}

export function PromptInput({ status, actions }: PromptInputProps) {
  const [value, setValue] = useState('')

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      if (status === 'running') actions.cancel()
      else actions.shutdown()
    }
  })

  function handleSubmit(raw: string): void {
    setValue('')
    const text = raw.trim()
    if (text === '') return
    if (text === '/exit' || text === '/quit') {
      actions.shutdown()
      return
    }
    if (text === '/status') {
      actions.status()
      return
    }
    if (text === '/model') {
      actions.openModelProfile()
      return
    }
    actions.send(text)
  }

  return (
    <Box borderStyle="round" borderColor="white" paddingX={1}>
      <Text>{'› '}</Text>
      <TextInput value={value} onChange={setValue} onSubmit={handleSubmit} />
    </Box>
  )
}
