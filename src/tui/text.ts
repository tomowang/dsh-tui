/**
 * Thin pi-tui `Component` wrappers around already-ANSI-styled strings.
 * `render.ts`/`markdown.ts`/`bannerText.ts` produce terminal-ready text
 * (colors, bold, links baked in via raw SGR/OSC sequences) — these wrappers
 * exist only to satisfy pi-tui's `Component` interface (`render(width)`,
 * `invalidate()`) without re-wrapping or re-styling that text, mirroring how
 * the old Ink `<Text>` usage printed these strings unmodified.
 * @module @tomowang/dsh-tui/tui/text
 */

import { wrapTextWithAnsi, type Component } from '@earendil-works/pi-tui'

/** Left/right margin applied to main-panel message content, so it doesn't sit flush against either terminal edge. */
const TRANSCRIPT_MARGIN = 2
const TRANSCRIPT_INDENT = ' '.repeat(TRANSCRIPT_MARGIN)

/** Word-wraps already-ANSI-styled text to fit within `width` minus the transcript's left/right margin, then indents every resulting line. Shared by `PreStyledText` (settled transcript rows) and the live-region rows (streaming text, pending tool calls, live shell output) so in-flight content lines up with what it settles into. */
export function padTranscriptText(text: string, width: number): string[] {
  if (text === '') return []
  const usableWidth = Math.max(1, width - TRANSCRIPT_MARGIN * 2)
  return wrapTextWithAnsi(text, usableWidth).map(line => `${TRANSCRIPT_INDENT}${line}`)
}

/** A static block of pre-styled text, replaceable via `setText`. Used for anything whose content changes over time (streaming text, status bar, stats line, …) but whose layout doesn't depend on the current terminal width. */
export class PreStyledText implements Component {
  private text: string

  constructor(text = '') {
    this.text = text
  }

  setText(text: string): void {
    this.text = text
  }

  getText(): string {
    return this.text
  }

  invalidate(): void {
    // No cache to invalidate — `render` re-wraps `text` every call.
  }

  render(width: number): string[] {
    return padTranscriptText(this.text, width)
  }
}

/** A block of pre-styled text rebuilt from the current viewport width on every render — for content (the banner) whose own layout is width-responsive. */
export class DynamicText implements Component {
  constructor(private readonly build: (width: number) => string) {}

  invalidate(): void {}

  render(width: number): string[] {
    const text = this.build(width)
    return text === '' ? [] : text.split('\n')
  }
}
