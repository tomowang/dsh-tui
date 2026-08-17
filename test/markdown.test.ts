import { describe, expect, it } from 'vitest'
import { looksLikeMarkdown, renderMarkdown } from '../src/markdown.js'

const ESC = '\x1b['

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
