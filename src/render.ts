/**
 * Terminal projection of durable session events. The TUI renders only from the
 * append-only session log, so a resumed session replays through the exact same
 * code path as live events.
 * @module @tomowang/dsh-tui/render
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** Where rendered lines go; tests substitute captures. */
export interface RenderIo {
  write(chunk: string): unknown
}

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
function truncate(text: string, max: number): string {
  const oneLine = text.replaceAll('\n', ' ')
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`
}

/** Join the text blocks of a message content array. */
function textOf(content: readonly { type: string; [key: string]: unknown }[]): string {
  return content
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('')
}

/**
 * Render one durable session event to the terminal. Unknown event types are
 * silently skipped: the log's vocabulary is merge-extensible and a transcript
 * viewer must tolerate events from plugins it does not know.
 * @param event - the durable session event to project.
 * @param io - output stream.
 * @param options - replay/live rendering context.
 */
export function renderEvent(event: SessionEvent, io: RenderIo, options: RenderOptions): void {
  switch (event.type) {
    case 'user/message': {
      // Live input was just typed by the reader; only replay re-shows it.
      if (!options.replay) return
      const text = textOf(event.data.content)
      if (text !== '') io.write(`${dim('you ›')} ${text}\n`)
      return
    }
    case 'assistant/message': {
      const text = textOf(event.data.message.content)
      if (text !== '') io.write(`\n${text}\n\n`)
      return
    }
    case 'tool/call': {
      io.write(`${cyan('⚙')} ${event.data.name} ${dim(truncate(event.data.arguments, 100))}\n`)
      return
    }
    case 'turn/end': {
      const reason = event.data.reason
      if (reason.kind === 'error') {
        io.write(`${red('✖')} ${reason.error.code}: ${reason.error.message}\n`)
      } else if (reason.kind === 'aborted') {
        io.write(`${yellow('⏹')} ${dim('turn canceled')}\n`)
      }
      return
    }
    default:
      // Merge-extensible union: events this viewer does not present fall through.
      return
  }
}
