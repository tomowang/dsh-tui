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
 *
 * A leading `!` typed at an empty prompt is Claude Code's shell-mode
 * convention: it switches Enter to run the line as a local shell command
 * (`TuiActions.runShell`, resolved outside the agent entirely — see
 * `src/index.ts`) instead of sending it to the agent, and the prompt box's
 * border/marker turn yellow for the duration. Backspace on an empty
 * shell-mode buffer (or Esc) exits back to normal mode, since the `!` itself
 * is consumed rather than inserted into `value`.
 * @module @tomowang/dsh-tui/tui/PromptInput
 */

import { useEffect, useRef, useState, type Dispatch } from 'react'
import { Box, Text, useInput } from 'ink'
import type { AgentStatus } from '@deepseek-ai/dsh-agent'
import { commandQuery, matchSlashCommands, runSlashCommand, SLASH_COMMAND_WIDTH } from './commands.js'
import { mentionQuery, matchFileCandidates } from './fileMention.js'
import type { FileIndexState } from './store.js'
import type { ProviderDraft, ProviderRow } from './modelProfile/types.js'
import type { QuestionAnswer } from './interaction/types.js'

export interface TuiActions {
  /** Route free text to steering (running) or follow-up (idle). */
  send(text: string): void
  /** Run one local shell command (not sent to the agent) and print its output to the transcript. */
  runShell(command: string): void
  /** Cancel the active turn. */
  cancel(): void
  /** Flush and exit. */
  shutdown(): void
  /** Publish a transient `/status` snapshot as the live-region notice. */
  status(): void
  /** Publish the `/help` command list and key shortcuts as the live-region notice. */
  help(): void
  /** Persist one newly submitted history line for cross-session up/down-arrow recall (best-effort; no-op without a settings service). */
  recordHistory(line: string): void
  /** Flush the current session, then start a brand-new one in a fresh screen. */
  clear(): void
  /** Switch to the next permission preset (read-only/workspace-write/full-access), wrapping around. */
  cyclePermission(): void
  /** Manually trigger session-history compaction via `ctx.compaction`. */
  compact(): void
  /** Start (or no-op if already loaded/loading) the background load backing the `@`-mention dropdown. */
  ensureFileIndex(): void

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

  /** Open the `/context` usage overlay. */
  openContext(): void
  /** Close the `/context` overlay. */
  closeContext(): void

  /** Open the `/plugins` loaded-plugin-tree overlay. */
  openPlugins(): void
  /** Close the `/plugins` overlay. */
  closePlugins(): void

  /** Open the `/presets` agent-preset overlay and start loading the roster. */
  openAgentPresets(): void
  /** Close the `/presets` overlay. */
  closeAgentPresets(): void
  /** Move the `/presets` list's selection cursor. */
  selectAgentPresetRow(index: number): void
  /** Apply a different agent preset to the current (blank) session. */
  applyAgentPreset(id: string): void

  /** Answer the pending in-terminal tool-approval prompt. */
  answerApproval(outcome: 'allowed-once' | 'rejected'): void
  /** Answer the pending in-terminal question prompt. */
  answerQuestion(answer: QuestionAnswer): void
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
  /** Backing file list for the `@`-mention dropdown, from `TuiStore`. */
  readonly fileIndex: FileIndexState
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
  /** True while a leading `!` (typed at an empty prompt) has switched Enter to run a local shell command instead of sending to the agent. */
  readonly shellMode: boolean
}

export const initialState: PromptState = { value: '', cursor: 0, selectedIndex: 0, historyIndex: null, draft: '', shellMode: false }

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
  | { type: 'completeMention'; start: number; end: number; text: string }
  | { type: 'enterShellMode' }
  | { type: 'exitShellMode' }

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
    case 'completeMention': {
      const inserted = `${action.text} `
      const value = state.value.slice(0, action.start) + inserted + state.value.slice(action.end)
      return { ...state, value, cursor: action.start + inserted.length }
    }
    case 'enterShellMode':
      return { ...state, shellMode: true }
    case 'exitShellMode':
      return { ...state, shellMode: false }
  }
}

export function PromptInput({ status, actions, state, dispatch, history, fileIndex }: PromptInputProps) {
  const [armedKey, setArmedKey] = useState<'c' | 'd' | null>(null)
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [mentionSelected, setMentionSelected] = useState(0)
  // Esc dismisses the dropdown for the current `@…` token without touching
  // the buffer; typing further (changing the query) reopens it, mirroring
  // how a dismissed slash-command list only stays gone until the text moves on.
  const [mentionDismissed, setMentionDismissed] = useState(false)

  useEffect(() => {
    return () => {
      if (armTimer.current) clearTimeout(armTimer.current)
    }
  }, [])

  // The `/` command palette never applies in shell mode, where a leading
  // slash is just a path character in the command being typed.
  const { isCommandMode, matches } = state.shellMode ? { isCommandMode: false, matches: [] } : commandQuery(state.value)
  const selected = matches.length === 0 ? 0 : Math.min(state.selectedIndex, matches.length - 1)
  const lines = state.value.split('\n')

  // `@`-mention mode never overlaps command mode: `isCommandMode` requires
  // the whole trimmed value to have no whitespace, so a later `@` only opens
  // once a space has ended the slash command.
  const mention = state.shellMode || isCommandMode ? { isMentionMode: false, query: '', start: -1 } : mentionQuery(state.value, state.cursor)
  const mentionOpen = mention.isMentionMode && !mentionDismissed
  const mentionMatches = mentionOpen ? matchFileCandidates(fileIndex.candidates ?? [], mention.query) : []
  const mentionSelectedClamped = mentionMatches.length === 0 ? 0 : Math.min(mentionSelected, mentionMatches.length - 1)

  useEffect(() => {
    setMentionSelected(0)
    setMentionDismissed(false)
  }, [mention.isMentionMode, mention.query])

  useEffect(() => {
    if (mention.isMentionMode) actions.ensureFileIndex()
  }, [mention.isMentionMode, actions])

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
    const shellMode = state.shellMode
    const selectedAtSubmit = selected
    dispatch({ type: 'reset' })
    if (trimmed === '') return
    if (history.at(-1) !== trimmed) {
      history.push(trimmed)
      actions.recordHistory(trimmed)
    }
    if (shellMode) {
      actions.runShell(trimmed)
      return
    }
    const commandMatches = trimmed.startsWith('/') && !/\s/.test(trimmed) ? matchSlashCommands(trimmed) : []
    if (commandMatches.length > 0) {
      const chosen = commandMatches[Math.min(selectedAtSubmit, commandMatches.length - 1)]
      runSlashCommand(chosen.command, actions)
      return
    }
    actions.send(trimmed)
  }

  useInput((input, key) => {
    // A leading `!` at an empty prompt switches Enter to run a local shell
    // command instead of sending to the agent, mirroring Claude Code's bash
    // mode. The `!` itself is consumed rather than inserted, so Backspace on
    // an empty shell-mode buffer (which would otherwise no-op) exits it —
    // same convention as Ctrl+C/Ctrl+D's exit-arming above.
    if (!state.shellMode && input === '!' && state.value === '' && !key.ctrl && !key.meta) {
      dispatch({ type: 'enterShellMode' })
      return
    }
    if (state.shellMode && (key.escape || (key.backspace && state.value === ''))) {
      dispatch({ type: 'exitShellMode' })
      return
    }
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
    // `@`-mention dropdown: Esc dismisses it for this token even with no
    // matches; Up/Down/Tab/Enter only apply once there's something to pick.
    if (mentionOpen) {
      if (key.escape) {
        setMentionDismissed(true)
        return
      }
      if (mentionMatches.length > 0) {
        if (key.upArrow || (key.ctrl && input === 'p')) {
          setMentionSelected((mentionSelectedClamped - 1 + mentionMatches.length) % mentionMatches.length)
          return
        }
        if (key.downArrow || (key.ctrl && input === 'n')) {
          setMentionSelected((mentionSelectedClamped + 1) % mentionMatches.length)
          return
        }
        if (key.tab || key.return) {
          dispatch({
            type: 'completeMention',
            // start is right after the `@` itself, so it's preserved in the
            // inserted text (`@src/index.ts `) rather than spliced away.
            start: mention.start + 1,
            end: mention.start + 1 + mention.query.length,
            text: mentionMatches[mentionSelectedClamped],
          })
          return
        }
      }
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
      {mentionOpen && fileIndex.candidates === undefined && (
        <Box paddingX={1}>
          <Text dimColor>loading files…</Text>
        </Box>
      )}
      {mentionOpen && fileIndex.candidates !== undefined && mentionMatches.length > 0 && (
        <Box flexDirection="column" paddingX={1}>
          {mentionMatches.map((path, i) => (
            <Text key={path} inverse={i === mentionSelectedClamped}>
              {path}
            </Text>
          ))}
        </Box>
      )}
      {armedKey !== null && <Text dimColor>Press Ctrl+{armedKey.toUpperCase()} again to exit</Text>}
      {state.shellMode && <Text color="yellow">! shell mode — Enter runs the command, Esc/Backspace exits</Text>}
      <Box borderStyle="round" borderColor={state.shellMode ? 'yellow' : 'white'} paddingX={1} flexDirection="column">
        {lines.map((line, i) => (
          <Box key={i}>
            <Text color={state.shellMode ? 'yellow' : undefined}>{i === 0 ? (state.shellMode ? '! ' : '› ') : '  '}</Text>
            {renderLineContent(line, i === cursorRow ? cursorCol : null)}
          </Box>
        ))}
      </Box>
    </Box>
  )
}
