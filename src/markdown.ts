/**
 * Terminal Markdown rendering for assistant text. `render.ts` prints
 * assistant/tool output straight to native scrollback via raw ANSI, so this
 * module detects whether a text blob is (at least partly) Markdown before
 * paying the cost of styling it — plain prose keeps rendering exactly as it
 * always has, only text carrying real Markdown syntax gets headers, bold,
 * lists, code spans, etc. converted to ANSI.
 * @module @tomowang/dsh-tui/markdown
 */

import { theme, fg } from './tui/theme.js'

const ESC = '\x1b['

const dim = fg(theme.muted)
const cyan = fg(theme.secondary)
const primary = fg(theme.primary)
const bold = (s: string): string => `${ESC}1m${s}${ESC}0m`
const italic = (s: string): string => `${ESC}3m${s}${ESC}0m`
const strike = (s: string): string => `${ESC}9m${s}${ESC}0m`
const underline = (s: string): string => `${ESC}4m${s}${ESC}0m`

/** Wrap `label` as an OSC 8 terminal hyperlink to `url`; terminals without OSC 8 support just print `label` and ignore the surrounding escapes. */
function hyperlink(url: string, label: string): string {
  return `\x1b]8;;${url}\x1b\\${label}\x1b]8;;\x1b\\`
}

const FENCE_RE = /^(\s*)(`{3,}|~{3,})\s*(\S*)\s*$/
const ATX_HEADER_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/
const HR_RE = /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/
const BLOCKQUOTE_RE = /^(\s*)((?:>\s?)+)(.*)$/
const UNORDERED_RE = /^(\s*)([-*+])\s+(.*)$/
const ORDERED_RE = /^(\s*)(\d+)([.)])\s+(.*)$/
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/
const LINK_RE = /\[([^\]\n]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/
const BOLD_RE = /\*\*([^*\n]+)\*\*|__([^_\n]+)__/
const INLINE_CODE_RE = /`([^`\n]+)`/
const ITALIC_RE = /(?<!\*)\*(?!\*)([^*\n]+)\*(?!\*)|(?<!_)_(?!_)([^_\n]+)_(?!_)/
const STRIKE_RE = /~~([^~\n]+)~~/

const LINK_RE_G = new RegExp(LINK_RE.source, 'g')
const BOLD_RE_G = new RegExp(BOLD_RE.source, 'g')
const ITALIC_RE_G = new RegExp(ITALIC_RE.source, 'g')
const STRIKE_RE_G = new RegExp(STRIKE_RE.source, 'g')
const INLINE_CODE_RE_G = new RegExp(INLINE_CODE_RE.source, 'g')

/**
 * Heuristically decides whether `text` carries Markdown markup worth
 * rendering, as opposed to plain prose that happens to contain a stray `*`
 * or `_`. Block-level syntax (fenced code, headers, rules, quotes, lists,
 * table rows) and unambiguous inline syntax (links, bold, strikethrough,
 * inline code) each single-handedly qualify. Lone single-`*`/`_` emphasis is
 * deliberately excluded: it is the highest false-positive-risk cue (globs,
 * multiplication, snake_case, `*args`) and easy to get wrong on its own, so
 * it only ever renders as emphasis when some other signal already confirmed
 * the text is Markdown.
 */
export function looksLikeMarkdown(text: string): boolean {
  for (const line of text.split('\n')) {
    if (
      FENCE_RE.test(line)
      || ATX_HEADER_RE.test(line)
      || HR_RE.test(line)
      || BLOCKQUOTE_RE.test(line)
      || UNORDERED_RE.test(line)
      || ORDERED_RE.test(line)
      || TABLE_ROW_RE.test(line)
    ) {
      return true
    }
  }
  return LINK_RE.test(text) || BOLD_RE.test(text) || STRIKE_RE.test(text) || INLINE_CODE_RE.test(text)
}

/** Style links, bold, strikethrough, and emphasis in a span already known to contain no inline code. */
function applyNonCodeInline(text: string): string {
  let working = text.replaceAll(LINK_RE_G, (_match, label: string, url: string) => hyperlink(url, underline(primary(label))))
  working = working.replaceAll(BOLD_RE_G, (_match, a: string | undefined, b: string | undefined) => bold(a ?? b ?? ''))
  working = working.replaceAll(STRIKE_RE_G, (_match, t: string) => strike(t))
  return working.replaceAll(ITALIC_RE_G, (_match, a: string | undefined, b: string | undefined) => italic(a ?? b ?? ''))
}

/**
 * Style one line's inline Markdown (links, bold, strikethrough, inline
 * code, emphasis). Splits on inline code spans first — `String.split` with
 * a single-capture-group regex interleaves the code contents (odd indices)
 * between the surrounding plain-text spans (even indices) — so a code
 * span's contents can never be mistaken for bold/italic/link syntax.
 */
function applyInline(text: string): string {
  return text
    .split(INLINE_CODE_RE_G)
    .map((part, i) => (i % 2 === 1 ? cyan(part) : applyNonCodeInline(part)))
    .join('')
}

/**
 * Render Markdown source to ANSI-styled terminal text: headers, fenced/
 * inline code, block quotes, ordered/unordered lists, rules, links, bold,
 * strikethrough, and emphasis. Text that `looksLikeMarkdown` rejects passes
 * through byte-for-byte unchanged.
 */
export function renderMarkdown(text: string): string {
  if (!looksLikeMarkdown(text)) return text

  const out: string[] = []
  let inCode = false
  let fenceChar = ''
  let fenceLen = 0

  for (const line of text.split('\n')) {
    const fence = FENCE_RE.exec(line)
    if (fence !== null && (!inCode || (fence[2][0] === fenceChar && fence[2].length >= fenceLen))) {
      if (inCode) {
        inCode = false
      } else {
        inCode = true
        fenceChar = fence[2][0]
        fenceLen = fence[2].length
        if (fence[3] !== '') out.push(dim(fence[3]))
      }
      continue
    }
    if (inCode) {
      out.push(dim(line))
      continue
    }

    const header = ATX_HEADER_RE.exec(line)
    if (header !== null) {
      const level = header[1].length
      const content = applyInline(header[2])
      out.push(level === 1 ? bold(primary(content)) : level === 2 ? bold(cyan(content)) : bold(content))
      continue
    }

    if (HR_RE.test(line)) {
      out.push(dim('─'.repeat(40)))
      continue
    }

    const quote = BLOCKQUOTE_RE.exec(line)
    if (quote !== null) {
      const depth = (quote[2].match(/>/g) ?? []).length
      out.push(`${dim('▏'.repeat(depth))} ${applyInline(quote[3])}`)
      continue
    }

    const unordered = UNORDERED_RE.exec(line)
    if (unordered !== null) {
      out.push(`${unordered[1]}${cyan('•')} ${applyInline(unordered[3])}`)
      continue
    }

    const ordered = ORDERED_RE.exec(line)
    if (ordered !== null) {
      out.push(`${ordered[1]}${cyan(`${ordered[2]}${ordered[3]}`)} ${applyInline(ordered[4])}`)
      continue
    }

    out.push(applyInline(line))
  }

  return out.join('\n')
}
