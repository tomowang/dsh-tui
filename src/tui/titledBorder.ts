/**
 * Pure line math for splicing a right-aligned title into a pi-tui `Editor`
 * box's top border — split out from `CustomEditor.withSessionTitle` so the
 * padding/precondition logic is testable without a real `Editor` instance
 * (which needs a `TUI`/terminal to construct).
 * @module @tomowang/dsh-tui/tui/titledBorder
 */

const bold = (s: string): string => `\x1b[1m${s}\x1b[0m`
// eslint-disable-next-line no-control-regex -- stripping SGR to test for the plain (unscrolled) border, the same escapes borderColor itself emits.
const SGR_RE = /\x1b\[[0-9;]*m/g

/**
 * Whether `line` is Editor's plain, unscrolled top border — a bare run of
 * `─` exactly `width` long, once its own `borderColor` SGR wrapper is
 * stripped. `false` for anything else, in particular pi-tui's own scroll-up
 * indicator (`createScrollBorder`, e.g. `─── ↑ 3 more ─────`), which must
 * win over a title splice: it's multi-line input's only affordance for
 * "there's more above".
 */
export function isPlainBorder(line: string, width: number): boolean {
  return line.replace(SGR_RE, '') === '─'.repeat(width)
}

/**
 * Right-aligned replacement for a plain top border, Claude Code CLI-style —
 * e.g. `───────────────── explore-dir`, bold and in the same color as the
 * border itself. `undefined` when `title` doesn't fit `width` (at least one
 * dash plus the separating space), so the caller leaves the plain border in
 * place rather than truncating the title.
 * @param width - the box's current render width.
 * @param title - session title to display flush right.
 * @param borderColor - this `Editor` instance's current border color function.
 */
export function buildTitledBorder(width: number, title: string, borderColor: (s: string) => string): string | undefined {
  const dashCount = width - title.length - 1
  if (dashCount < 0) return undefined
  return borderColor('─'.repeat(dashCount)) + ' ' + bold(borderColor(title))
}
