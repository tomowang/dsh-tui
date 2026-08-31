/**
 * Pure event-log → transcript-lines projection for a viewed subagent
 * child's transcript — split out of `TranscriptArea` (in `TuiApp`) so it's
 * testable against plain `SessionEvent[]` fixtures, without a live pi-tui
 * `Component`. Builds its own `tool/call` name/argument lookup scoped to
 * the given events: the main transcript's own `TuiStore.getToolCall` only
 * knows about the live session's own calls, not a subagent child's.
 * @module @tomowang/dsh-tui/tui/agents/detailLines
 */

import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { formatEvent, type RenderOptions } from '../../render.js'

/** One event log's `tool/call` events, keyed by `callId` — everything a later `tool/result` in the same log needs to present with (see `RenderOptions.getToolCall`). */
export function buildToolCallLookup(events: readonly SessionEvent[]): ReadonlyMap<ToolCallId, { name: string; arguments: string }> {
  const toolCalls = new Map<ToolCallId, { name: string; arguments: string }>()
  for (const event of events) {
    if (event.type === 'tool/call') toolCalls.set(event.data.callId, { name: event.data.name, arguments: event.data.arguments })
  }
  return toolCalls
}

/**
 * Render one event log through `formatEvent`, flattened into individual
 * terminal lines — a formatted event can itself span multiple lines (e.g. a
 * multi-line user message or an assistant reply). An event `formatEvent`
 * has nothing to show for (`undefined` or `''`) contributes no lines.
 */
export function buildAgentDetailLines(events: readonly SessionEvent[], getTool: RenderOptions['getTool']): string[] {
  const toolCalls = buildToolCallLookup(events)
  const options: RenderOptions = { replay: false, getTool, getToolCall: callId => toolCalls.get(callId) }
  const lines: string[] = []
  for (const event of events) {
    const formatted = formatEvent(event, options)
    if (formatted !== undefined && formatted !== '') lines.push(...formatted.split('\n'))
  }
  return lines
}
