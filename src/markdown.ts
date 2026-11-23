/**
 * Terminal Markdown rendering for assistant text. `render.ts` prints
 * assistant/tool output straight to native scrollback via raw ANSI, so this
 * module detects whether a text blob is (at least partly) Markdown before
 * paying the cost of styling it — plain prose keeps rendering exactly as it
 * always has, only text carrying real Markdown syntax gets headers, bold,
 * lists, code spans, tables, etc. converted to ANSI.
 * @module @tomowang/dsh-tui/markdown
 */

import { wrapTextWithAnsi } from '@earendil-works/pi-tui'
import { safeHyperlinkUrl } from './sanitize.js'
import { theme, fg } from './tui/theme.js'

const ESC = '\x1b['

const dim = fg(theme.muted)
const cyan = fg(theme.secondary)
const primary = fg(theme.primary)
const bold = (s: string): string => `${ESC}1m${s}${ESC}0m`
const italic = (s: string): string => `${ESC}3m${s}${ESC}0m`
const strike = (s: string): string => `${ESC}9m${s}${ESC}0m`
const underline = (s: string): string => `${ESC}4m${s}${ESC}0m`

/** Wrap `label` as an OSC 8 terminal hyperlink to `url`; terminals without OSC 8 support just print `label` and ignore the surrounding escapes. A URL that isn't http/https/mailto, or carries control bytes, gets the bare label instead. */
function hyperlink(url: string, label: string): string {
  const safe = safeHyperlinkUrl(url)
  return safe === undefined ? label : `\x1b]8;;${safe}\x1b\\${label}\x1b]8;;\x1b\\`
}

const FENCE_RE = /^(\s*)(`{3,}|~{3,})\s*(\S*)\s*$/
const ATX_HEADER_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/
const HR_RE = /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/
const BLOCKQUOTE_RE = /^(\s*)((?:>\s?)+)(.*)$/
const UNORDERED_RE = /^(\s*)([-*+])\s+(.*)$/
const ORDERED_RE = /^(\s*)(\d+)([.)])\s+(.*)$/
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/
const TABLE_SEPARATOR_CELL_RE = /^:?-+:?$/
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

type TableAlign = 'left' | 'center' | 'right'

/** Split a line already confirmed by `TABLE_ROW_RE` into trimmed cells, dropping the framing `|`. */
function splitTableRow(line: string): string[] {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return inner.split('|').map(cell => cell.trim())
}

/**
 * A GFM delimiter row: every cell is dashes with optional leading/trailing
 * colons for alignment. Returns each column's alignment, or `null` when
 * `line` isn't a valid delimiter row — the caller then treats the preceding
 * line as ordinary text rather than a table header.
 */
function parseTableSeparator(line: string): TableAlign[] | null {
  const cells = splitTableRow(line)
  const aligns: TableAlign[] = []
  for (const cell of cells) {
    if (!TABLE_SEPARATOR_CELL_RE.test(cell)) return null
    const left = cell.startsWith(':')
    const right = cell.endsWith(':')
    aligns.push(left && right ? 'center' : right ? 'right' : 'left')
  }
  return aligns
}

/** Every escape this module's own `fg`/`bold`/`italic`/`strike`/`underline`/`hyperlink` helpers emit: SGR sequences and OSC 8 hyperlinks (BEL- or ST-terminated). */
// eslint-disable-next-line no-control-regex -- matching the ANSI escapes this module's own styling helpers emit requires their literal control bytes.
const ANSI_RE = /\x1b\][^\x07]*\x07|\x1b\][^\x1b]*\x1b\\|\x1b\[[0-9;]*m/g

const MARK_RE = /\p{Mn}|\p{Me}/u
const EMOJI_PRESENTATION_RE = /\p{Emoji_Presentation}/u

/** East Asian wide/fullwidth code points: CJK, Hangul, kana, fullwidth forms. */
function isWideCodePoint(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2329 && cp <= 0x232a) ||
    (cp >= 0x2e80 && cp <= 0x303e) ||
    (cp >= 0x3041 && cp <= 0x33ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xa960 && cp <= 0xa97f) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe10 && cp <= 0xfe19) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x16fe0 && cp <= 0x18cff) ||
    (cp >= 0x1b000 && cp <= 0x1b2ff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  )
}

/**
 * Terminal cell width of one code point: zero for controls, combining marks
 * and zero-width characters, two for wide characters and emoji, one otherwise.
 * `nextCp` is the code point that follows, so a variation selector 16 can
 * widen its base character to the emoji presentation the terminal renders.
 */
function charWidth(cp: number, nextCp: number | undefined): number {
  if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) return 0
  if (cp === 0x00ad || cp === 0x200b || cp === 0x200c || cp === 0x200d || cp === 0x2060 || cp === 0xfeff) return 0
  if (cp >= 0xfe00 && cp <= 0xfe0f) return 0
  const char = String.fromCodePoint(cp)
  if (MARK_RE.test(char)) return 0
  if (nextCp === 0xfe0f) return 2
  return isWideCodePoint(cp) || EMOJI_PRESENTATION_RE.test(char) ? 2 : 1
}

/** Display width of escape-free text, in terminal cells. */
function displayWidth(text: string): number {
  const codePoints = Array.from(text, char => char.codePointAt(0) ?? 0)
  let width = 0
  for (let i = 0; i < codePoints.length; i++) width += charWidth(codePoints[i], codePoints[i + 1])
  return width
}

/**
 * Visible length of an already-styled cell: ANSI escapes have string length
 * but no on-screen width, so measuring `styled.length` directly would
 * overcount by however many escape bytes the cell's markup produced.
 * Stripping them first — rather than measuring the pre-styling raw source
 * — also fixes the companion bug that source length would otherwise cause:
 * `**bold**`'s raw text is 4 characters longer than what it renders as, so
 * a column sized from raw source overcounts a bold cell's true width, and
 * that same bold cell then looks "wide enough" and gets under-padded
 * relative to its plain siblings. Width is measured in terminal cells, not
 * UTF-16 code units: CJK text and emoji occupy two cells per code point and
 * combining marks occupy none, so a table stays aligned when its cells mix
 * scripts. Treating the cell's length as its width would make every column
 * with a wide character too narrow.
 */
function visibleLength(styled: string): number {
  return displayWidth(styled.replace(ANSI_RE, ''))
}

/** Pad an already-styled cell out to `width`, measuring by `visibleLength` rather than `styled.length`. */
function padCell(styled: string, width: number, align: TableAlign): string {
  const gap = Math.max(0, width - visibleLength(styled))
  if (align === 'right') return ' '.repeat(gap) + styled
  if (align === 'center') {
    const left = Math.floor(gap / 2)
    return ' '.repeat(left) + styled + ' '.repeat(gap - left)
  }
  return styled + ' '.repeat(gap)
}

/** Cell separator between two table columns. */
const TABLE_GAP = ' │ '
/** Narrowest a column may shrink to; below this a wrapped CJK cell would be one character per line. */
const MIN_TABLE_COLUMN = 8

/**
 * Shrink natural column widths so the rendered table fits `maxWidth` terminal
 * cells. Without this, one long cell (a paragraph in a "status" column) pushes
 * the row past the terminal edge: the terminal soft-wraps it, and every `│`
 * after the wrap lands mid-column, which is what a wide table looks like when
 * it "breaks". Columns keep at least `MIN_TABLE_COLUMN` cells and never grow.
 */
function fitTableWidths(natural: readonly number[], maxWidth: number | undefined): number[] {
  const gaps = TABLE_GAP.length * Math.max(0, natural.length - 1)
  const sum = natural.reduce((total, width) => total + width, 0)
  if (maxWidth === undefined || sum + gaps <= maxWidth) return natural.slice()

  const budget = Math.max(natural.length * 2, maxWidth - gaps)
  // On a terminal narrower than MIN_TABLE_COLUMN * columns there is no room
  // for the comfortable floor; drop to an even split rather than overflowing.
  const minColumn = Math.max(2, Math.min(MIN_TABLE_COLUMN, Math.floor(budget / natural.length)))
  const scale = budget / sum
  const widths = natural.map(width => Math.max(minColumn, Math.min(width, Math.floor(width * scale))))
  let total = widths.reduce((acc, width) => acc + width, 0)
  // Proportional shrink leaves rounding slack behind; trim the widest column
  // one cell at a time until the table actually fits.
  while (total > budget) {
    let widest = -1
    for (let i = 0; i < widths.length; i++) {
      if (widths[i] > minColumn && (widest === -1 || widths[i] > widths[widest])) widest = i
    }
    if (widest === -1) break
    widths[widest] -= 1
    total -= 1
  }
  return widths
}

/** Word-wrap one already-styled cell to `width` terminal cells; empty cells still occupy one line. */
function wrapTableCell(styled: string, width: number): string[] {
  if (visibleLength(styled) <= width) return [styled]
  const lines = wrapTextWithAnsi(styled, width)
  return lines.length === 0 ? [''] : lines
}

/**
 * Render one logical table row. Cells that wrap produce continuation lines
 * padded to the same column widths, so the `│` boundaries stay aligned on
 * every physical line instead of being redrawn by the terminal's own wrap.
 */
function formatTableRow(
  styledCells: readonly string[],
  widths: readonly number[],
  aligns: readonly TableAlign[],
  isHeader: boolean,
): string[] {
  const wrapped = widths.map((width, i) => {
    const lines = wrapTableCell(styledCells[i] ?? '', width)
    return isHeader ? lines.map(line => bold(line)) : lines
  })
  const height = Math.max(1, ...wrapped.map(lines => lines.length))
  const out: string[] = []
  for (let line = 0; line < height; line++) {
    out.push(
      widths
        .map((width, i) => padCell(wrapped[i][line] ?? '', width, aligns[i] ?? 'left'))
        .join(dim(TABLE_GAP)),
    )
  }
  return out
}

/** A dim horizontal rule under the header row, with a cross at each column boundary. */
function formatTableRule(widths: readonly number[]): string {
  return dim(widths.map(width => '─'.repeat(width)).join('─┼─'))
}

/**
 * Render Markdown source to ANSI-styled terminal text: headers, fenced/
 * inline code, block quotes, ordered/unordered lists, rules, tables, links,
 * bold, strikethrough, and emphasis. Text that `looksLikeMarkdown` rejects
 * passes through byte-for-byte unchanged.
 *
 * `maxWidth` bounds how wide a rendered table may get, in terminal cells;
 * omit it to keep the table at its natural width (previous behaviour). Cells
 * that no longer fit wrap inside their column instead of letting the terminal
 * soft-wrap the row.
 */
export function renderMarkdown(text: string, maxWidth?: number): string {
  if (!looksLikeMarkdown(text)) return text

  const out: string[] = []
  let inCode = false
  let fenceChar = ''
  let fenceLen = 0

  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (!inCode && TABLE_ROW_RE.test(line) && i + 1 < lines.length) {
      const aligns = TABLE_ROW_RE.test(lines[i + 1]) ? parseTableSeparator(lines[i + 1]) : null
      if (aligns !== null) {
        // Styled once here and reused for both width measurement and the
        // final row text, so a column's width can never diverge from what
        // padCell actually measures when placing its cells.
        const styledHeader = splitTableRow(line).map(cell => applyInline(cell))
        const styledRows: string[][] = []
        let j = i + 2
        for (; j < lines.length && TABLE_ROW_RE.test(lines[j]); j++) {
          styledRows.push(splitTableRow(lines[j]).map(cell => applyInline(cell)))
        }

        const columns = Math.max(styledHeader.length, ...styledRows.map(row => row.length), aligns.length)
        const naturalWidths = Array.from({ length: columns }, (_, col) =>
          Math.max(visibleLength(styledHeader[col] ?? ''), ...styledRows.map(row => visibleLength(row[col] ?? ''))))
        const widths = fitTableWidths(naturalWidths, maxWidth)
        const columnAligns = Array.from({ length: columns }, (_, col) => aligns[col] ?? 'left')

        out.push(...formatTableRow(styledHeader, widths, columnAligns, true))
        out.push(formatTableRule(widths))
        for (const styledRow of styledRows) out.push(...formatTableRow(styledRow, widths, columnAligns, false))

        i = j - 1
        continue
      }
    }

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
