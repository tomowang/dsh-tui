/**
 * Pure conversation-to-title-request logic for bare `/rename` — split out
 * from index.ts's on-demand title generation so source-text collection is
 * testable against plain `SessionEvent[]` fixtures, without a live
 * `ctx.llm` to call. Mirrors the harness's own `dsh-session-title`
 * package's `collectSessionTitleMessages` (human `user/message` events
 * only, text blocks only, empty text dropped) but returns bare strings
 * rather than seq-attributed rows: an on-demand call has no revision or
 * attribution bookkeeping to thread back through.
 * @module @tomowang/dsh-tui/tui/titleGeneration
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { textOf } from '../render.js'

/**
 * Fixed instruction for the on-demand title call, mirroring the harness's
 * own `dsh-session-title-llm` system prompt/length conventions (this
 * deployment's `targetWords`/`targetCjkCharacters` are 5/10 — see the
 * `session-title-llm` row in `dsh --dump-config`).
 */
export const TITLE_GENERATION_SYSTEM_PROMPT =
  'Return one concise, unadorned title summarizing this conversation, in the input language: at most 5 words, or 10 characters for Chinese/Japanese/Korean. No punctuation, no quotes, no explanation — the title text only.'

/**
 * Every eligible human message's text, in log order — the source material
 * for the on-demand title call. A message with no text content (e.g.
 * image-only) or only whitespace is dropped rather than kept as an empty
 * entry.
 */
export function collectRenameSourceTexts(events: readonly SessionEvent[]): string[] {
  return events
    .filter((event): event is Extract<SessionEvent, { type: 'user/message' }> =>
      event.type === 'user/message' && event.data.source.kind === 'user')
    .map(event => textOf(event.data.content).trim())
    .filter(text => text !== '')
}
