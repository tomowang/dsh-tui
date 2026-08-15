/**
 * The reader's line of input: free text steers/follows up the agent, and a
 * small set of terminal-only commands control the session. The line editor
 * is hand-rolled (not `ink-text-input`) so it can track a real cursor offset
 * and support multi-line drafts — needed for readline-style navigation
 * (Home/End, Ctrl+A/E, word motion, Ctrl+K/U/W) and for Shift+Enter /
 * Alt+Enter / trailing-backslash-Enter to insert a newline instead of
 * submitting.
 *
 * Buffer edits go through a reducer (`bufferReducer`), not plain `useState`,
 * because Ink batches keypresses that arrive in the same stdin chunk (e.g. a
 * held-down arrow key) and dispatches them synchronously before React
 * re-renders. A setter that reads `cursor`/`value` from the component's
 * render closure would see the same pre-batch snapshot for every keypress in
 * that chunk and only the last one would stick; a reducer always computes
 * from the *previous action's* result, so a run of keypresses lands in full.
 *
 * Ctrl+C cancels a running turn while one is active — the raw-mode
 * replacement for the readline-based SIGINT handling this component
 * displaces. While idle, Ctrl+C first clears any typed text (mirroring
 * shell readline); only a press with an empty line arms the exit sequence.
 * Ctrl+D forward-deletes at the cursor while there's text, and arms exit
 * only once the line is empty — mirroring the same shell convention.
 * Pressing Ctrl+C or Ctrl+D twice in a row while the line is empty exits; a
 * single press only arms the other and shows a hint, and the arm expires
 * after a short timeout.
 * @module @tomowang/dsh-tui/tui/PromptInput
 */

import { useEffect, useRef, useState, type Dispatch } from 'react'
import { Box, Text, useInput } from 'ink'
import type { AgentStatus } from '@deepseek-ai/dsh-agent'
import { commandQuery, matchSlashCommands, runSlashCommand, SLASH_COMMAND_WIDTH } from './commands.js'
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
  /** Flush the current session, then start a brand-new one in a fresh screen. */
  clear(): void
  /** Switch to the next permission preset (read-only/workspace-write/full-access), wrapping around. */
  cyclePermission(): void

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

  /** Open the `/trajectory` ledger overlay. */
  openTrajectory(): void
  /** Close the `/trajectory` overlay. */
  closeTrajectory(): void
}

export interface PromptInputProps {
  readonly status: AgentStatus
  readonly actions: TuiActions
  /**
   * The prompt buffer, owned by `App` so it can size the layout around the
   * command dropdown and multi-line drafts in the same render that
   * `PromptInput` reflects them in — see `bufferReducer`'s module doc.
   */
  readonly state: PromptState
  readonly dispatch: Dispatch<Action>
  /**
   * Submitted-line history for up/down-arrow recall. Owned by the caller
   * (outside the Ink tree) so it survives `/clear` remounting this component.
   */
  readonly history: string[]
}

const EXIT_ARM_TIMEOUT_MS = 2000

// --- Cursor/line-motion helpers, mirroring GNU readline's word/line units ---

function lineStartIndex(text: string, pos: number): number {
  const before = text.lastIndexOf('\n', pos - 1)
  return before === -1 ? 0 : before + 1
}

function lineEndIndex(text: string, pos: number): number {
  const after = text.indexOf('\n', pos)
  return after === -1 ? text.length : after
}

// backward-word / forward-word: skip whitespace, then the adjoining run of
// non-whitespace — the same unit Ctrl+W (below) kills.
function backwardWordBoundary(text: string, pos: number): number {
  let i = pos
  while (i > 0 && /\s/.test(text[i - 1])) i--
  while (i > 0 && !/\s/.test(text[i - 1])) i--
  return i
}

function forwardWordBoundary(text: string, pos: number): number {
  let i = pos
  while (i < text.length && /\s/.test(text[i])) i++
  while (i < text.length && !/\s/.test(text[i])) i++
  return i
}

function computeRowCol(text: string, offset: number): { row: number; col: number } {
  const upToCursor = text.slice(0, offset)
  const lastNewline = upToCursor.lastIndexOf('\n')
  const row = (upToCursor.match(/\n/g) ?? []).length
  return { row, col: offset - (lastNewline + 1) }
}

// Moves the cursor a visual line up/down, clamping to the target line's
// length; a no-op at the first/last line (the caller decides what to do
// with that, e.g. fall back to history recall).
function moveCursorVertically(text: string, cursor: number, direction: -1 | 1): number {
  const { col } = computeRowCol(text, cursor)
  if (direction === -1) {
    const curLineStart = lineStartIndex(text, cursor)
    if (curLineStart === 0) return cursor
    const prevLineEnd = curLineStart - 1
    const prevLineStart = lineStartIndex(text, prevLineEnd)
    return prevLineStart + Math.min(col, prevLineEnd - prevLineStart)
  }
  const curLineEnd = lineEndIndex(text, cursor)
  if (curLineEnd === text.length) return cursor
  const nextLineStart = curLineEnd + 1
  const nextLineEnd = lineEndIndex(text, nextLineStart)
  return nextLineStart + Math.min(col, nextLineEnd - nextLineStart)
}

function renderLineContent(line: string, cursorCol: number | null) {
  if (cursorCol === null) return <Text>{line.length > 0 ? line : ' '}</Text>
  const before = line.slice(0, cursorCol)
  const atCursor = line[cursorCol] ?? ' '
  const after = line.slice(cursorCol + 1)
  return (
    <Text>
      {before}
      <Text inverse>{atCursor}</Text>
      {after}
    </Text>
  )
}

// --- Buffer state/reducer ---

export interface PromptState {
  readonly value: string
  readonly cursor: number
  readonly selectedIndex: number
  readonly historyIndex: number | null
  /** The in-progress draft, stashed when history recall starts so Down can restore it. */
  readonly draft: string
}

export const initialState: PromptState = { value: '', cursor: 0, selectedIndex: 0, historyIndex: null, draft: '' }

export type Action =
  | { type: 'insert'; text: string }
  | { type: 'backspace' }
  | { type: 'deleteForward' }
  | { type: 'killWordBack' }
  | { type: 'killWordForward' }
  | { type: 'killLineEnd' }
  | { type: 'killLineStart' }
  | { type: 'moveHome' }
  | { type: 'moveEnd' }
  | { type: 'moveWordLeft' }
  | { type: 'moveWordRight' }
  | { type: 'moveLeft' }
  | { type: 'moveRight' }
  | { type: 'up'; history: readonly string[] }
  | { type: 'down'; history: readonly string[] }
  | { type: 'newline' }
  | { type: 'newlineFromBackslash' }
  | { type: 'reset' }
  | { type: 'completeCommand'; text: string }

export function bufferReducer(state: PromptState, action: Action): PromptState {
  switch (action.type) {
    case 'insert': {
      const value = state.value.slice(0, state.cursor) + action.text + state.value.slice(state.cursor)
      return { ...state, value, cursor: state.cursor + action.text.length }
    }
    case 'backspace': {
      if (state.cursor === 0) return state
      const value = state.value.slice(0, state.cursor - 1) + state.value.slice(state.cursor)
      return { ...state, value, cursor: state.cursor - 1 }
    }
    case 'deleteForward': {
      if (state.cursor >= state.value.length) return state
      const value = state.value.slice(0, state.cursor) + state.value.slice(state.cursor + 1)
      return { ...state, value }
    }
    case 'killWordBack': {
      const start = backwardWordBoundary(state.value, state.cursor)
      const value = state.value.slice(0, start) + state.value.slice(state.cursor)
      return { ...state, value, cursor: start }
    }
    case 'killWordForward': {
      const end = forwardWordBoundary(state.value, state.cursor)
      const value = state.value.slice(0, state.cursor) + state.value.slice(end)
      return { ...state, value }
    }
    case 'killLineEnd': {
      const end = lineEndIndex(state.value, state.cursor)
      const value = state.value.slice(0, state.cursor) + state.value.slice(end)
      return { ...state, value }
    }
    case 'killLineStart': {
      const start = lineStartIndex(state.value, state.cursor)
      const value = state.value.slice(0, start) + state.value.slice(state.cursor)
      return { ...state, value, cursor: start }
    }
    case 'moveHome':
      return { ...state, cursor: lineStartIndex(state.value, state.cursor) }
    case 'moveEnd':
      return { ...state, cursor: lineEndIndex(state.value, state.cursor) }
    case 'moveWordLeft':
      return { ...state, cursor: backwardWordBoundary(state.value, state.cursor) }
    case 'moveWordRight':
      return { ...state, cursor: forwardWordBoundary(state.value, state.cursor) }
    case 'moveLeft':
      return { ...state, cursor: Math.max(0, state.cursor - 1) }
    case 'moveRight':
      return { ...state, cursor: Math.min(state.value.length, state.cursor + 1) }
    // Priority: the command-palette selector, then vertical motion within a
    // multi-line draft, then history recall — recall only kicks in for a
    // single-line buffer, so an in-progress multi-line draft is never
    // silently clobbered by a history entry.
    case 'up': {
      const { isCommandMode, matches } = commandQuery(state.value)
      if (state.historyIndex === null && isCommandMode && matches.length > 0) {
        const count = matches.length
        return { ...state, selectedIndex: (state.selectedIndex - 1 + count) % count }
      }
      if (state.value.includes('\n')) {
        return { ...state, cursor: moveCursorVertically(state.value, state.cursor, -1) }
      }
      if (action.history.length === 0) return state
      if (state.historyIndex === null) {
        const text = action.history[action.history.length - 1]
        return { ...state, value: text, cursor: text.length, historyIndex: action.history.length - 1, draft: state.value }
      }
      if (state.historyIndex > 0) {
        const nextIndex = state.historyIndex - 1
        const text = action.history[nextIndex]
        return { ...state, value: text, cursor: text.length, historyIndex: nextIndex }
      }
      return state
    }
    case 'down': {
      const { isCommandMode, matches } = commandQuery(state.value)
      if (state.historyIndex === null && isCommandMode && matches.length > 0) {
        const count = matches.length
        return { ...state, selectedIndex: (state.selectedIndex + 1) % count }
      }
      if (state.value.includes('\n')) {
        return { ...state, cursor: moveCursorVertically(state.value, state.cursor, 1) }
      }
      if (state.historyIndex === null) return state
      if (state.historyIndex < action.history.length - 1) {
        const nextIndex = state.historyIndex + 1
        const text = action.history[nextIndex]
        return { ...state, value: text, cursor: text.length, historyIndex: nextIndex }
      }
      return { ...state, value: state.draft, cursor: state.draft.length, historyIndex: null }
    }
    case 'newline': {
      const value = state.value.slice(0, state.cursor) + '\n' + state.value.slice(state.cursor)
      return { ...state, value, cursor: state.cursor + 1 }
    }
    case 'newlineFromBackslash': {
      // Replaces the backslash immediately before the cursor with a
      // newline, so the total length (and thus the cursor offset) is unchanged.
      const value = state.value.slice(0, state.cursor - 1) + '\n' + state.value.slice(state.cursor)
      return { ...state, value }
    }
    case 'reset':
      return initialState
    case 'completeCommand':
      return { ...state, value: action.text, cursor: action.text.length }
  }
}

export function PromptInput({ status, actions, state, dispatch, history }: PromptInputProps) {
  const [armedKey, setArmedKey] = useState<'c' | 'd' | null>(null)
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (armTimer.current) clearTimeout(armTimer.current)
    }
  }, [])

  const { isCommandMode, matches } = commandQuery(state.value)
  const selected = matches.length === 0 ? 0 : Math.min(state.selectedIndex, matches.length - 1)
  const lines = state.value.split('\n')

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

  function submit(): void {
    const trimmed = state.value.trim()
    const selectedAtSubmit = selected
    dispatch({ type: 'reset' })
    if (trimmed === '') return
    if (history.at(-1) !== trimmed) history.push(trimmed)
    const commandMatches = trimmed.startsWith('/') && !/\s/.test(trimmed) ? matchSlashCommands(trimmed) : []
    if (commandMatches.length > 0) {
      const chosen = commandMatches[Math.min(selectedAtSubmit, commandMatches.length - 1)]
      runSlashCommand(chosen.command, actions)
      return
    }
    actions.send(trimmed)
  }

  useInput((input, key) => {
    // Shift+Tab cycles the permission preset, mirroring Claude Code's mode
    // switcher. Terminals send the classic `\x1b[Z` sequence, which Ink
    // reports as `key.tab` with `key.shift` set — distinct from plain Tab.
    if (key.tab && key.shift) {
      actions.cyclePermission()
      return
    }
    // Tab completes the input to the highlighted command's text (shell-style
    // completion) without running it — Enter still confirms. Leaves the
    // suggestion list open since the completed text still matches itself.
    if (key.tab && isCommandMode && matches.length > 0) {
      dispatch({ type: 'completeCommand', text: matches[selected].command })
      return
    }
    if (key.ctrl && input === 'c') {
      if (status === 'running') {
        actions.cancel()
        return
      }
      if (state.value !== '') {
        dispatch({ type: 'reset' })
        if (armTimer.current) clearTimeout(armTimer.current)
        setArmedKey(null)
        return
      }
      armOrConfirmExit('c')
      return
    }
    if (key.ctrl && input === 'd') {
      if (status === 'running') return
      if (state.value !== '') {
        dispatch({ type: 'deleteForward' })
        return
      }
      armOrConfirmExit('d')
      return
    }

    // Ctrl+W / Alt+Backspace: kill the word behind the cursor.
    if ((key.ctrl && input === 'w') || (key.backspace && key.meta)) {
      dispatch({ type: 'killWordBack' })
      return
    }
    // Alt+D: kill the word ahead of the cursor.
    if (key.meta && input === 'd') {
      dispatch({ type: 'killWordForward' })
      return
    }
    // Ctrl+K: kill to end of the current line. Ctrl+U: kill to its start.
    if (key.ctrl && input === 'k') {
      dispatch({ type: 'killLineEnd' })
      return
    }
    if (key.ctrl && input === 'u') {
      dispatch({ type: 'killLineStart' })
      return
    }

    // Home/Ctrl+A and End/Ctrl+E: jump to the start/end of the current line.
    if (key.home || (key.ctrl && input === 'a')) {
      dispatch({ type: 'moveHome' })
      return
    }
    if (key.end || (key.ctrl && input === 'e')) {
      dispatch({ type: 'moveEnd' })
      return
    }

    // Word motion: Alt+Left/Right, Alt+B/F, or Ctrl+Left/Right.
    if ((key.leftArrow && (key.meta || key.ctrl)) || (key.meta && input === 'b')) {
      dispatch({ type: 'moveWordLeft' })
      return
    }
    if ((key.rightArrow && (key.meta || key.ctrl)) || (key.meta && input === 'f')) {
      dispatch({ type: 'moveWordRight' })
      return
    }
    // Char motion: arrow keys or Ctrl+B/F.
    if (key.leftArrow || (key.ctrl && input === 'b')) {
      dispatch({ type: 'moveLeft' })
      return
    }
    if (key.rightArrow || (key.ctrl && input === 'f')) {
      dispatch({ type: 'moveRight' })
      return
    }

    if (key.backspace) {
      dispatch({ type: 'backspace' })
      return
    }
    if (key.delete) {
      dispatch({ type: 'deleteForward' })
      return
    }

    if (key.upArrow || (key.ctrl && input === 'p')) {
      dispatch({ type: 'up', history })
      return
    }
    if (key.downArrow || (key.ctrl && input === 'n')) {
      dispatch({ type: 'down', history })
      return
    }

    if (key.return) {
      // A trailing backslash before the cursor is a portable "insert
      // newline" fallback for terminals that don't report Shift+Enter
      // distinctly from Enter.
      if (state.cursor > 0 && state.value[state.cursor - 1] === '\\') {
        dispatch({ type: 'newlineFromBackslash' })
        return
      }
      if (key.shift || key.meta) {
        dispatch({ type: 'newline' })
        return
      }
      submit()
      return
    }

    // Anything left over is printable text (including a multi-character
    // paste) — insert it at the cursor. Stray, unhandled Ctrl/Alt combos
    // are ignored rather than dumped into the buffer.
    if (input.length > 0 && !key.ctrl && !key.meta) {
      dispatch({ type: 'insert', text: input.replace(/\r\n?/g, '\n') })
    }
  })

  const { row: cursorRow, col: cursorCol } = computeRowCol(state.value, state.cursor)

  return (
    <Box flexDirection="column">
      {isCommandMode && matches.length > 0 && (
        <Box flexDirection="column" paddingX={1}>
          {matches.map((cmd, i) => (
            <Text key={cmd.command} inverse={i === selected}>
              {cmd.command.padEnd(SLASH_COMMAND_WIDTH)} {cmd.description}
            </Text>
          ))}
        </Box>
      )}
      {armedKey !== null && <Text dimColor>Press Ctrl+{armedKey.toUpperCase()} again to exit</Text>}
      <Box borderStyle="round" borderColor="white" paddingX={1} flexDirection="column">
        {lines.map((line, i) => (
          <Box key={i}>
            <Text>{i === 0 ? '› ' : '  '}</Text>
            {renderLineContent(line, i === cursorRow ? cursorCol : null)}
          </Box>
        ))}
      </Box>
    </Box>
  )
}
