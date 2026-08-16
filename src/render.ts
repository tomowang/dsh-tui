/**
 * Terminal projection of durable session events. The TUI renders only from the
 * append-only session log, so a resumed session replays through the exact same
 * code path as live events.
 * @module @tomowang/dsh-tui/render
 */

import { diffLines } from 'diff'
import type { CallId, ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { FileDiff, ToolCallView, ToolDefinition, ToolResult, ToolResultView } from '@deepseek-ai/dsh-tools'

/** Rendering context: replay walks history already in the log. */
export interface RenderOptions {
  /** True while replaying persisted events on startup. */
  replay: boolean
  /** Look up a tool's declared presentation by name; absent outside the live TUI (e.g. tests). */
  getTool?: (name: string) => ToolDefinition | undefined
  /** Look up a `tool/call`'s name/arguments by `callId`, for a later `tool/result` to present with. */
  getToolCall?: (callId: CallId) => { name: string; arguments: string } | undefined
}

const ESC = '\x1b['
const dim = (s: string): string => `${ESC}2m${s}${ESC}0m`
const cyan = (s: string): string => `${ESC}36m${s}${ESC}0m`
const red = (s: string): string => `${ESC}31m${s}${ESC}0m`
const green = (s: string): string => `${ESC}32m${s}${ESC}0m`
const yellow = (s: string): string => `${ESC}33m${s}${ESC}0m`

/** Line cap for a presented tool card's body; `<Static>` prints are permanent, so a long card gets a summary, not a fold. */
const MAX_CARD_LINES = 20
/** `diff` package's `maxEditLength`: bounds worst-case diff cost on a huge file, mirroring the removed first-party TUI's default. */
const MAX_DIFF_EDIT_LENGTH = 1000

/** Clamp one-line summaries so tool arguments cannot flood the transcript. */
export function truncate(text: string, max: number): string {
  const oneLine = text.replaceAll('\n', ' ')
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`
}

/** Join the text blocks of a message content array. */
export function textOf(content: readonly ContentBlock[]): string {
  return content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

/**
 * Format the in-progress step's accumulated text, mirroring `assistant/message`'s
 * framing so the line doesn't visually jump once it settles into `<Static>`.
 */
export function formatStreamingText(text: string): string | undefined {
  return text === '' ? undefined : `\n${text}\n`
}

/** One local shell-escape run's header + output lines, shared by the settled and in-flight renderers below. `exitCode` is `null` while still running. */
function formatShellLines(command: string, output: string, exitCode: number | null): string[] {
  const lines = [`${yellow('!')} ${command}`]
  if (output !== '') lines.push(...splitLines(output).map(dim))
  if (exitCode !== null) lines.push(exitCode === 0 ? dim(`[exit ${exitCode}]`) : red(`[exit ${exitCode}]`))
  return lines
}

/** Format one settled local shell-escape run (`!` prompt-mode) for the permanent transcript, mirroring a `terminal` tool card. */
export function formatShellRun(command: string, output: string, exitCode: number | null): string {
  const lines = capLines(formatShellLines(command, output, exitCode), MAX_CARD_LINES)
  return `\n${lines.join('\n')}\n`
}

/** Format the in-progress shell-escape run's accumulated output for the live region, mirroring `formatStreamingText`'s settle-without-jump framing. */
export function formatShellRunLive(command: string, output: string): string {
  const lines = capLines(formatShellLines(command, output, null), MAX_CARD_LINES)
  return `\n${lines.join('\n')}\n`
}

/** Parse a tool call's JSON-encoded arguments; malformed JSON can't be handed to a presenter. */
function parseJson(text: string): { valid: true; value: unknown } | { valid: false } {
  try {
    return { valid: true, value: JSON.parse(text) as unknown }
  } catch {
    return { valid: false }
  }
}

/** Render a value for display: a string as-is, anything else as pretty JSON. */
function pretty(value: unknown): string {
  if (typeof value === 'string') return value
  const serialized = JSON.stringify(value, null, 2) as string | undefined
  return serialized ?? String(value)
}

/** A string's content lines: empty text is zero lines, a trailing newline terminates the last line. */
function splitLines(text: string): string[] {
  if (text === '') return []
  const body = text.endsWith('\n') ? text.slice(0, -1) : text
  return body.split('\n')
}

/** Cap a card body to `max` lines, appending a dim summary of what was omitted. */
function capLines(lines: readonly string[], max: number): string[] {
  if (lines.length <= max) return [...lines]
  const omitted = lines.length - max
  return [...lines.slice(0, max), dim(`… +${omitted} line${omitted === 1 ? '' : 's'} omitted`)]
}

/**
 * One file's change as +/- diff lines under a dim path header. A `null` prior
 * text (new file, or a call-time overwrite with no before-image) renders the
 * whole new text as additions; a comparison beyond `MAX_DIFF_EDIT_LENGTH` falls
 * back to whole-side add/remove so a huge file can't stall formatting.
 */
function renderFileDiff(diff: FileDiff): string[] {
  const lines = [dim(diff.path)]
  if (diff.oldText === null) {
    for (const line of splitLines(diff.newText)) lines.push(green(`+ ${line}`))
    return lines
  }
  const changes = diffLines(diff.oldText, diff.newText, { maxEditLength: MAX_DIFF_EDIT_LENGTH })
  if (changes === undefined) {
    lines.push(dim(`[diff omitted: over ${MAX_DIFF_EDIT_LENGTH} changed lines]`))
    for (const line of splitLines(diff.oldText)) lines.push(red(`- ${line}`))
    for (const line of splitLines(diff.newText)) lines.push(green(`+ ${line}`))
    return lines
  }
  for (const change of changes) {
    const prefix = change.added ? '+' : change.removed ? '-' : ' '
    const color = change.added ? green : change.removed ? red : dim
    for (const line of splitLines(change.value)) lines.push(color(`${prefix} ${line}`))
  }
  return lines
}

/** One or more `FileDiff`s, blank-line separated when there's more than one. */
function renderFileDiffs(diffs: readonly FileDiff[]): string[] {
  return diffs.flatMap((fileDiff, index) => (index > 0 ? [''] : []).concat(renderFileDiff(fileDiff)))
}

/** Today's flat one-line fallback for a pending call, unchanged: no tool, no presenter, bad JSON, or a throwing/`undefined` presenter. */
function fallbackCallLine(name: string, rawArgs: string): string {
  return `${cyan('⚙')} ${name} ${dim(truncate(rawArgs, 100))}`
}

/** Resolve a `tool/call`'s presented view, or `undefined` for any condition that keeps the flat fallback. */
function presentCallSafely(name: string, rawArgs: string, getTool: RenderOptions['getTool']): ToolCallView | undefined {
  const tool = getTool?.(name)
  if (tool?.presentCall === undefined) return undefined
  const parsed = parseJson(rawArgs)
  if (!parsed.valid) return undefined
  try {
    return tool.presentCall(parsed.value)
  } catch {
    return undefined
  }
}

/** A presented pending call's lines: a cyan header (the presenter's title) plus card-specific body. */
function formatCallLines(view: ToolCallView): string[] {
  const header = `${cyan('⚙')} ${view.title}`
  if (view.card === 'terminal') {
    const lines: string[] = []
    if (view.description !== undefined && view.description !== '') lines.push(dim(view.description))
    lines.push(header)
    if (view.cwd !== undefined) lines.push(dim(view.cwd))
    return lines
  }
  if (view.card === 'diff') {
    return [header, ...renderFileDiffs(view.diffs)]
  }
  const rawInput = view.rawInput === undefined ? [] : splitLines(pretty(view.rawInput)).map(dim)
  return [header, ...rawInput]
}

/** Format a `tool/call` event, presenting through the tool's `presentCall` when available. */
function formatToolCall(name: string, rawArgs: string, getTool: RenderOptions['getTool']): string {
  const view = presentCallSafely(name, rawArgs, getTool)
  if (view === undefined) return fallbackCallLine(name, rawArgs)
  const lines = capLines(formatCallLines(view), MAX_CARD_LINES)
  return lines.length <= 1 ? lines[0] : `\n${lines.join('\n')}\n`
}

/** Resolve a `tool/result`'s presented view, or `undefined` for any condition that keeps the flat fallback. */
function presentResultSafely(
  callId: CallId,
  result: ToolResult,
  options: RenderOptions,
): { name: string; view: ToolResultView } | undefined {
  const call = options.getToolCall?.(callId)
  if (call === undefined) return undefined
  const tool = options.getTool?.(call.name)
  if (tool?.presentResult === undefined) return undefined
  const parsed = parseJson(call.arguments)
  if (!parsed.valid) return undefined
  try {
    const view = tool.presentResult(parsed.value, result)
    return view === undefined ? undefined : { name: call.name, view }
  } catch {
    return undefined
  }
}

/** A presented completed call's lines: an outcome-colored header plus card-specific body. */
function formatResultLines(fallbackName: string, icon: string, rawContent: readonly ContentBlock[], view: ToolResultView): string[] {
  const header = `${icon} ${view.title ?? fallbackName}`
  switch (view.card) {
    case 'generic': {
      const body = splitLines(textOf(view.content ?? rawContent)).map(dim)
      return [header, ...body]
    }
    case 'terminal': {
      const lines = [header]
      if (view.output !== undefined && view.output !== '') lines.push(...splitLines(view.output).map(dim))
      if (view.exitCode !== undefined) lines.push(dim(`[exit ${view.exitCode}]`))
      if (view.signal !== undefined) lines.push(red(`[signal ${view.signal}]`))
      return lines
    }
    case 'diff': {
      return [header, ...renderFileDiffs(view.diffs)]
    }
    case 'search': {
      const lines = [header]
      let shown = 0
      if (view.shape === 'matches') {
        for (const file of view.files) {
          lines.push(dim(file.path))
          for (const match of file.matches) lines.push(dim(`  ${match.lineNumber}: ${match.line}`))
          shown += file.matches.length
        }
      } else {
        for (const path of view.paths) lines.push(dim(path))
        shown = view.paths.length
      }
      if (view.truncated) lines.push(dim(`… showing ${shown} of ${view.total}`))
      return lines
    }
    case 'read': {
      // Falls back to the read path, not the tool name — a read result's
      // salient identity is which file it read, not which tool read it.
      const lines = [`${icon} ${view.title ?? view.path}`]
      for (const line of view.lines) lines.push(dim(`${line.number}: ${line.text}`))
      if (view.totalLines > 0) {
        const last = view.offset + view.lines.length - 1
        lines.push(dim(`[${view.offset}-${last} of ${view.totalLines}]`))
      }
      return lines
    }
    case 'web': {
      const lines = [header]
      if (view.kind === 'search') {
        for (const source of view.sources) lines.push(dim(`${source.title ?? source.url} — ${source.url}`))
        if (view.answer !== undefined && view.answer !== '') lines.push(...splitLines(view.answer).map(dim))
      } else {
        lines.push(dim(`${view.url} [${view.statusCode}]`))
      }
      if (view.truncated) lines.push(dim('… truncated'))
      return lines
    }
  }
}

/**
 * Format one durable session event as a terminal line, or `undefined` for
 * events this viewer does not present. Unknown event types are silently
 * skipped: the log's vocabulary is merge-extensible and a transcript viewer
 * must tolerate events from plugins it does not know.
 * @param event - the durable session event to project.
 * @param options - replay/live rendering context, plus optional tool-presentation resolvers.
 */
export function formatEvent(event: SessionEvent, options: RenderOptions): string | undefined {
  switch (event.type) {
    case 'user/message': {
      const source = event.data.source
      // Only a direct human prompt gets the full transcript line; synthetic
      // context (`agent.inject()` — subdir AGENTS.md, skill content, cron
      // notices, …) collapses to one label instead of dumping its content.
      if (source.kind === 'user') {
        const text = textOf(event.data.content)
        return text === '' ? undefined : `${dim('you ›')} ${text}`
      }
      if (source.kind === 'plugin') {
        const summary = source.form === 'notice' ? source.summary : undefined
        return `${dim('⊕ context ›')} ${source.plugin}${summary === undefined ? '' : ` · ${summary}`}`
      }
      return `${dim('⊕ context ›')} ${source.kind}`
    }
    case 'assistant/message': {
      const text = textOf(event.data.message.content)
      return text === '' ? undefined : `\n${text}\n`
    }
    case 'tool/call': {
      return formatToolCall(event.data.name, event.data.arguments, options.getTool)
    }
    case 'tool/result': {
      // `error` marks an internal/harness-level failure (distinct from
      // `isError` on the block, which is the ordinary model-facing outcome).
      // An internal failure is the harness's to report, not a tool's to
      // reformat, so it bypasses presentation entirely.
      if (event.data.error !== undefined) {
        return `${red('✖')} ${event.data.error.code}: ${event.data.error.name}`
      }
      const [block] = event.data.message.content
      const failed = block.isError === true
      const icon = failed ? red('✖') : cyan('✓')
      const callId = event.data.message.source.callId
      const result: ToolResult = { content: block.content, isError: failed, ...event.data.meta !== undefined ? { meta: event.data.meta } : {} }
      const presented = presentResultSafely(callId, result, options)
      if (presented === undefined) {
        const text = truncate(textOf(block.content), 100)
        return text === '' ? icon : `${icon} ${dim(text)}`
      }
      const lines = capLines(formatResultLines(presented.name, icon, block.content, presented.view), MAX_CARD_LINES)
      return lines.length <= 1 ? lines[0] : `\n${lines.join('\n')}\n`
    }
    case 'turn/end': {
      const reason = event.data.reason
      if (reason.kind === 'error') {
        return `${red('✖')} ${reason.error.code}: ${reason.error.message}`
      } else if (reason.kind === 'aborted') {
        return `${yellow('⏹')} ${dim('turn canceled')}`
      }
      return undefined
    }
    case 'compaction/summary': {
      return `${cyan('⊙')} compacted ${event.data.shadowedSeqs.length} items (~${event.data.shadowedTokenCount} tokens)`
    }
    case 'compaction/end': {
      return event.data.error === undefined ? undefined : `${red('✖')} compaction: ${event.data.error}`
    }
    default:
      // Merge-extensible union: events this viewer does not present fall through.
      return undefined
  }
}
