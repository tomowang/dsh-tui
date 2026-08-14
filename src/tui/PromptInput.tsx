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

export interface TuiActions {
  /** Route free text to steering (running) or follow-up (idle). */
  send(text: string): void
  /** Cancel the active turn. */
  cancel(): void
  /** Flush and exit. */
  shutdown(): void
  /** Publish a transient `/status` snapshot as the live-region notice. */
  status(): void
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
    actions.send(text)
  }

  return (
    <Box>
      <Text>{'› '}</Text>
      <TextInput value={value} onChange={setValue} onSubmit={handleSubmit} />
    </Box>
  )
}
