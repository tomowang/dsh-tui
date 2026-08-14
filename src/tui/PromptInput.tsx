/**
 * The reader's line of input: free text steers/follows up the agent, and a
 * small set of terminal-only commands control the session. Ctrl+C cancels a
 * running turn while one is active — the raw-mode replacement for the
 * readline-based SIGINT handling this component displaces. While idle,
 * pressing Ctrl+C or Ctrl+D twice in a row exits; a single press only arms
 * the other and shows a hint, and the arm expires after a short timeout.
 * @module @tomowang/dsh-tui/tui/PromptInput
 */

import { useEffect, useRef, useState } from 'react'
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

const EXIT_ARM_TIMEOUT_MS = 2000

export function PromptInput({ status, actions, onCommandMatchesChange }: PromptInputProps) {
  const [value, setValue] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [armedKey, setArmedKey] = useState<'c' | 'd' | null>(null)
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const historyRef = useRef<string[]>([])
  const [historyIndex, setHistoryIndex] = useState<number | null>(null)
  const draftRef = useRef('')

  useEffect(() => {
    return () => {
      if (armTimer.current) clearTimeout(armTimer.current)
    }
  }, [])

  // A trailing space (but no *internal* whitespace) still counts as command
  // mode, so `"/status "` behaves like the old `raw.trim() === '/status'`.
  const query = value.trim()
  const isCommandMode = value.startsWith('/') && !/\s/.test(query)
  const matches = isCommandMode ? matchSlashCommands(query) : []
  const selected = matches.length === 0 ? 0 : Math.min(selectedIndex, matches.length - 1)

  // A second press of the same key within the timeout confirms exit; a
  // different key (or an expired arm) starts a fresh arm instead.
  function armOrConfirmExit(k: 'c' | 'd'): void {
    if (armedKey === k) {
      if (armTimer.current) clearTimeout(armTimer.current)
      actions.shutdown()
      return
    }
    if (armTimer.current) clearTimeout(armTimer.current)
    setArmedKey(k)
    armTimer.current = setTimeout(() => {
      armTimer.current = null
      setArmedKey(null)
    }, EXIT_ARM_TIMEOUT_MS)
  }

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      if (status === 'running') {
        actions.cancel()
        return
      }
      armOrConfirmExit('c')
      return
    }
    if (key.ctrl && input === 'd') {
      // ink-text-input's own useInput handler runs before this one and,
      // lacking a Ctrl+D case, inserts a literal "d" into the buffer —
      // revert that before deciding what Ctrl+D should actually do.
      setValue(value)
      if (status === 'running') return
      armOrConfirmExit('d')
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
      return
    }
    if (key.upArrow) {
      const history = historyRef.current
      if (history.length === 0) return
      if (historyIndex === null) {
        draftRef.current = value
        const nextIndex = history.length - 1
        setHistoryIndex(nextIndex)
        setValue(history[nextIndex])
      } else if (historyIndex > 0) {
        const nextIndex = historyIndex - 1
        setHistoryIndex(nextIndex)
        setValue(history[nextIndex])
      }
      return
    }
    if (key.downArrow) {
      if (historyIndex === null) return
      const history = historyRef.current
      if (historyIndex < history.length - 1) {
        const nextIndex = historyIndex + 1
        setHistoryIndex(nextIndex)
        setValue(history[nextIndex])
      } else {
        setHistoryIndex(null)
        setValue(draftRef.current)
      }
      return
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
    setHistoryIndex(null)
    onCommandMatchesChange?.(0)
    const trimmed = raw.trim()
    if (trimmed === '') return
    if (historyRef.current.at(-1) !== trimmed) historyRef.current.push(trimmed)
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
      {armedKey !== null && <Text dimColor>Press Ctrl+{armedKey.toUpperCase()} again to exit</Text>}
      <Box borderStyle="round" borderColor="white" paddingX={1}>
        <Text>{'› '}</Text>
        <TextInput value={value} onChange={handleValueChange} onSubmit={handleSubmit} />
      </Box>
    </Box>
  )
}
