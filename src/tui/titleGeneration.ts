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
 * Fixed instruction for the on-demand title call. Deliberately diverges from
 * the harness's own `dsh-session-title-llm` system prompt (which asks for
 * "plain text of natural language") to match Claude Code CLI's kebab-case
 * slug convention instead — this feature is explicitly modeled on that CLI's
 * `/rename`, not the harness's Web UI. `toKebabCase` is the enforcement of
 * last resort if a smaller/local model doesn't follow the format exactly.
 */
export const TITLE_GENERATION_SYSTEM_PROMPT =
  'Create a concise kebab-case slug summarizing this conversation, in the input language: lowercase words joined by hyphens, at most 5 words. No punctuation other than hyphens, no quotes, no explanation — the slug text only.'

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

/**
 * Deterministically reshape arbitrary model output into a kebab-case slug —
 * the prompt asks for this shape already, but a smaller/local model isn't
 * guaranteed to comply (stray punctuation, title case, an explanatory
 * sentence), so this is applied unconditionally rather than trusted to the
 * prompt alone. Splits on any run of non-letter/non-digit characters
 * (Unicode-aware, so this holds up for non-Latin scripts too), drops empty
 * pieces, and keeps at most `maxWords` of them.
 */
export function toKebabCase(text: string, maxWords = 5): string {
  const words = text
    .replace(/['’]/g, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(word => word !== '')
    .slice(0, maxWords)
  return words.join('-')
}
