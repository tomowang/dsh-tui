import { describe, expect, it } from 'vitest'
import { looksLikeMarkdown, renderMarkdown } from '../src/markdown.js'

const ESC = '\x1b['

/** Strip SGR and OSC 8 escapes so a table-alignment assertion can compare visual column positions. */
// eslint-disable-next-line no-control-regex -- matching the ANSI escapes this module's own `fg`/`hyperlink` helpers emit requires their literal control bytes.
const stripAnsi = (s: string): string => s.replaceAll(/\x1b\][^\x07]*\x07|\x1b\][^\x1b]*\x1b\\|\x1b\[[0-9;]*m/g, '')

describe('looksLikeMarkdown', () => {
  it('rejects plain prose', () => {
    expect(looksLikeMarkdown('Hello there, how can I help?')).toBe(false)
  })

  it('rejects prose with a stray asterisk or underscore', () => {
    expect(looksLikeMarkdown('cd * && rm some_file')).toBe(false)
  })

  it('detects an ATX header', () => {
    expect(looksLikeMarkdown('# Title\n\nbody text')).toBe(true)
  })

  it('detects a fenced code block', () => {
    expect(looksLikeMarkdown('before\n```ts\nconst x = 1\n```\nafter')).toBe(true)
  })

  it('detects an unordered list', () => {
    expect(looksLikeMarkdown('- one\n- two')).toBe(true)
  })

  it('detects an ordered list', () => {
    expect(looksLikeMarkdown('1. one\n2. two')).toBe(true)
  })

  it('detects a blockquote', () => {
    expect(looksLikeMarkdown('> quoted text')).toBe(true)
  })

  it('detects a horizontal rule', () => {
    expect(looksLikeMarkdown('above\n---\nbelow')).toBe(true)
  })

  it('detects a table row', () => {
    expect(looksLikeMarkdown('| a | b |\n| - | - |')).toBe(true)
  })

  it('detects a link', () => {
    expect(looksLikeMarkdown('see [the docs](https://example.com) for more')).toBe(true)
  })

  it('detects bold text', () => {
    expect(looksLikeMarkdown('this is **important**')).toBe(true)
  })

  it('detects strikethrough text', () => {
    expect(looksLikeMarkdown('this is ~~wrong~~ right')).toBe(true)
  })

  it('detects inline code', () => {
    expect(looksLikeMarkdown('run `npm install` first')).toBe(true)
  })

  it('does not treat lone single-asterisk emphasis alone as markdown', () => {
    expect(looksLikeMarkdown('the *quick* fox')).toBe(false)
  })
})

describe('renderMarkdown', () => {
  it('passes plain prose through unchanged', () => {
    expect(renderMarkdown('just some text')).toBe('just some text')
  })

  it('bolds and colors an H1 header', () => {
    const out = renderMarkdown('# Title')
    expect(out).toContain('Title')
    expect(out).toContain(`${ESC}1m`)
    expect(out).not.toContain('#')
  })

  it('strips leading hashes from headers of any level', () => {
    const out = renderMarkdown('### Section')
    expect(out).toContain('Section')
    expect(out).not.toContain('#')
  })

  it('dims fenced code block content and strips the fence markers', () => {
    const out = renderMarkdown('before\n```ts\nconst x = 1\n```\nafter')
    expect(out).toContain('const x = 1')
    expect(out).not.toContain('```')
    expect(out).toContain('ts')
  })

  it('does not apply inline formatting inside a fenced code block', () => {
    const out = renderMarkdown('```\n**not bold**\n```\nplain **bold** text')
    const lines = out.split('\n')
    expect(lines[0]).toContain('**not bold**')
    expect(lines.at(-1)).not.toContain('**')
  })

  it('renders a bullet for unordered list items', () => {
    const out = renderMarkdown('- first\n- second')
    expect(out).toContain('•')
    expect(out).toContain('first')
    expect(out).toContain('second')
    expect(out).not.toMatch(/^- /m)
  })

  it('keeps ordered list numbering', () => {
    const out = renderMarkdown('1. first\n2. second')
    expect(out).toContain('1.')
    expect(out).toContain('2.')
    expect(out).toContain('first')
  })

  it('prefixes blockquote lines with a marker', () => {
    const out = renderMarkdown('> quoted')
    expect(out).toContain('▏')
    expect(out).toContain('quoted')
  })

  it('renders a horizontal rule as a dim line', () => {
    const out = renderMarkdown('above\n---\nbelow')
    expect(out).toContain('─')
  })

  it('bolds **text**', () => {
    const out = renderMarkdown('this is **important** ok, and `x`')
    expect(out).toContain('important')
    expect(out).not.toContain('**')
  })

  it('colors inline code and leaves surrounding text alone', () => {
    const out = renderMarkdown('run `npm install` first, and **note**')
    expect(out).toContain('npm install')
    expect(out).not.toContain('`npm install`')
  })

  it('does not mangle asterisks inside an inline code span', () => {
    const out = renderMarkdown('use `a ** b` here, and **bold**')
    expect(out).toContain('a ** b')
  })

  it('strikes ~~text~~', () => {
    const out = renderMarkdown('this is ~~wrong~~, and **so** is that')
    expect(out).toContain('wrong')
    expect(out).not.toContain('~~')
  })

  it('renders a link as an OSC 8 hyperlink and keeps the label text', () => {
    const out = renderMarkdown('see [the docs](https://example.com) for `more`')
    expect(out).toContain('the docs')
    expect(out).toContain('https://example.com')
    expect(out).not.toContain('[the docs]')
  })

  it('renders a table with aligned columns and a header rule', () => {
    const doc = ['| Feature | Description |', '|---|---|', '| Bash | Run shell commands |', '| FS | Read and write files |'].join('\n')
    const out = renderMarkdown(doc)
    const lines = out.split('\n')
    expect(lines).toHaveLength(4)
    expect(out).not.toContain('---')
    expect(out).toContain('┼')
    expect(out).toContain('│')
    expect(out).toContain('Feature')
    expect(out).toContain('Bash')
    expect(out).toContain('Run shell commands')
    // Same column start for every data row: the widest cell in each column
    // sets that column's width for every other row. Strip ANSI first — the
    // bold header carries extra escape bytes before its pipe that a raw
    // string index would wrongly count against the visual column.
    const barColumn = (line: string): number => stripAnsi(line).indexOf('│')
    expect(barColumn(lines[0])).toBe(barColumn(lines[2]))
    expect(barColumn(lines[0])).toBe(barColumn(lines[3]))
  })

  it('bolds the table header row', () => {
    const out = renderMarkdown('| a |\n|---|\n| b |')
    const lines = out.split('\n')
    expect(lines[0]).toContain(`${ESC}1m`)
    expect(lines[2]).not.toContain(`${ESC}1m`)
  })

  it('applies inline formatting inside table cells', () => {
    const out = renderMarkdown('| Name | Note |\n|---|---|\n| `x` | **important** |')
    expect(out).toContain('important')
    expect(out).not.toContain('**')
    expect(out).not.toContain('`x`')
  })

  it('sizes and pads a column from visible length, not raw Markdown source length', () => {
    // A bold cell's raw source ('**abc**', 7 chars) is longer than what it
    // renders as ('abc', 3 chars); sizing/padding from the raw source both
    // inflates the column past its true widest visible cell (here 'Note',
    // 4 chars) and leaves the bold cell itself under-padded, since its
    // already-long raw length looks like it "fills" the inflated width.
    const out = renderMarkdown('| Note |\n|---|\n| **abc** |\n| xyz |')
    const lines = stripAnsi(out).split('\n')
    expect(lines).toEqual(['Note', '────', 'abc ', 'xyz '])
  })

  // Terminal cell width for the scripts used below: CJK ideographs and
  // emoji-presentation characters occupy two cells, everything else one.
  // Deliberately independent of the renderer's own width ranges.
  const cellWidth = (s: string): number => {
    let width = 0
    for (const char of s) {
      const cp = char.codePointAt(0) ?? 0
      width += (cp >= 0x2e80 && cp <= 0x9fff) || /\p{Emoji_Presentation}/u.test(char) ? 2 : 1
    }
    return width
  }

  it('sizes columns by terminal cell width when cells contain CJK text', () => {
    const out = renderMarkdown(
      ['| 颜色 | 数法 |', '|---|---|', '| 白白 | 从 4 个白球里选 2 个 |', '| 一白一黑 | 1 个白 × 1 个黑 |'].join('\n'),
    )
    const lines = stripAnsi(out).split('\n')
    // Every row pads to the same total width, so the row's closing '│' lands
    // on the same terminal cell even though the rows' UTF-16 lengths differ.
    expect(new Set(lines.map(cellWidth)).size).toBe(1)
    const barOffset = (line: string): number => cellWidth(line.slice(0, line.indexOf('│')))
    expect(new Set(lines.filter(line => line.includes('│')).map(barOffset)).size).toBe(1)
  })

  it('sizes columns by terminal cell width when cells contain emoji', () => {
    const out = renderMarkdown(['| 状态 | 说明 |', '|---|---|', '| ✅ | 通过 |', '| ❌ | 失败 |'].join('\n'))
    const lines = stripAnsi(out).split('\n')
    expect(new Set(lines.map(cellWidth)).size).toBe(1)
    const barOffset = (line: string): number => cellWidth(line.slice(0, line.indexOf('│')))
    expect(new Set(lines.filter(line => line.includes('│')).map(barOffset)).size).toBe(1)
  })

  it('wraps an overlong cell inside the table instead of overflowing maxWidth', () => {
    // One status cell is a whole sentence: at its natural width the row would
    // run past the terminal, which then soft-wraps it and leaves the following
    // `│` separators mid-column. With maxWidth the table must wrap the cell
    // instead, keeping every physical line within the budget and every `│` at
    // the same column.
    const doc = [
      '| 模块 | 状态 |',
      '|---|---|',
      '| lab2 | arprtr、buggy、fnptr 都有实现，fnptr 的 numbers 三个 TODO 都补了，strings 去重做了 bsearch 版，另写了 lfind 版 strings1 |',
    ].join('\n')
    const lines = stripAnsi(renderMarkdown(doc, 40)).split('\n')
    expect(lines.length).toBeGreaterThan(3)
    expect(Math.max(...lines.map(cellWidth))).toBeLessThanOrEqual(40)
    const barOffset = (line: string): number => cellWidth(line.slice(0, line.indexOf('│')))
    expect(new Set(lines.filter(line => line.includes('│')).map(barOffset)).size).toBe(1)
  })

  it('keeps natural widths when the table already fits maxWidth', () => {
    const doc = ['| a | b |', '|---|---|', '| 1 | 2 |'].join('\n')
    expect(renderMarkdown(doc, 200)).toBe(renderMarkdown(doc))
  })

  it('right-aligns and center-aligns columns per the delimiter row', () => {
    // Two data rows so each column has a narrower cell whose padding is
    // actually observable (a column's widest cell gets none by definition).
    const out = renderMarkdown('| L | C | R |\n|:--|:-:|--:|\n| a | bb | c |\n| aaa | b | ccc |')
    const lines = stripAnsi(out).split('\n')
    // R is right-aligned: the narrower 'c' (row 1) pads on the left to match 'ccc' (row 2).
    expect(lines[2].endsWith('  c')).toBe(true)
    // C is centered: the narrower 'b' (row 2) pads to match the 2-wide 'bb' column, trimming to 'b'.
    const cCell = (line: string): string => line.split('│')[1]?.trim()
    expect(cCell(lines[2])).toBe('bb')
    expect(cCell(lines[3])).toBe('b')
  })

  it('does not treat an isolated pipe-containing line as a table', () => {
    const out = renderMarkdown('this has a | pipe but no header/separator pair, and **bold**')
    expect(out).not.toContain('┼')
    expect(out).toContain('bold')
  })

  it('does not treat a table-like line inside a fenced code block as a table', () => {
    const out = renderMarkdown('```\n| a | b |\n|---|---|\n```')
    expect(out).not.toContain('┼')
    expect(out).toContain('| a | b |')
  })

  it('handles ragged rows with fewer or more cells than the header', () => {
    const out = renderMarkdown('| a | b | c |\n|---|---|---|\n| short |\n| long | row | with | extra |')
    const lines = out.split('\n')
    expect(lines).toHaveLength(4)
    expect(out).toContain('short')
    expect(out).toContain('extra')
  })

  it('handles a mixed document with headers, lists, and code together', () => {
    const doc = [
      '# Plan',
      '',
      '- step one',
      '- step two',
      '',
      '```sh',
      'echo hi',
      '```',
      '',
      'Done, see `notes.md` for **details**.',
    ].join('\n')
    const out = renderMarkdown(doc)
    expect(out).toContain('Plan')
    expect(out).toContain('•')
    expect(out).toContain('echo hi')
    expect(out).toContain('notes.md')
    expect(out).toContain('details')
    expect(out).not.toContain('```')
    expect(out).not.toContain('**details**')
  })
})
