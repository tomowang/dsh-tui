/**
 * Terminal projection of durable session events. The TUI renders only from the
 * append-only session log, so a resumed session replays through the exact same
 * code path as live events.
 * @module @tomowang/dsh-tui/render
 */

import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** Rendering context: replay walks history already in the log. */
export interface RenderOptions {
  /** True while replaying persisted events on startup. */
  replay: boolean
}

const ESC = '\x1b['
const dim = (s: string): string => `${ESC}2m${s}${ESC}0m`
const cyan = (s: string): string => `${ESC}36m${s}${ESC}0m`
const red = (s: string): string => `${ESC}31m${s}${ESC}0m`
const yellow = (s: string): string => `${ESC}33m${s}${ESC}0m`

/** Clamp one-line summaries so tool arguments cannot flood the transcript. */
export function truncate(text: string, max: number): string {
  const oneLine = text.replaceAll('\n', ' ')
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`
}

/** Join the text blocks of a message content array. */
function textOf(content: readonly ContentBlock[]): string {
  return content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

/**
 * Format one durable session event as a terminal line, or `undefined` for
 * events this viewer does not present. Unknown event types are silently
 * skipped: the log's vocabulary is merge-extensible and a transcript viewer
 * must tolerate events from plugins it does not know.
 * @param event - the durable session event to project.
 * @param options - replay/live rendering context.
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
      return `${cyan('⚙')} ${event.data.name} ${dim(truncate(event.data.arguments, 100))}`
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
    default:
      // Merge-extensible union: events this viewer does not present fall through.
      return undefined
  }
}
