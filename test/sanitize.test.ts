import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { safeHyperlinkUrl, sanitizeDeep, sanitizeTerminalText, sanitizeTitle } from '../src/sanitize.js'
import { renderMarkdown } from '../src/markdown.js'
import { formatEvent, formatShellRun, formatStreamingText, formatToolCardDetail } from '../src/render.js'
import { buildTerminalTitle } from '../src/tui/liveText.js'
import { TuiStore } from '../src/tui/store.js'

const OSC52 = '\x1b]52;c;ZWNobyBwd25lZA==\x07'

describe('sanitizeTerminalText', () => {
  it('returns control-free text unchanged', () => {
    const text = 'plain prose with *stars*, `code`, tabs\tand\nnewlines — ünïcödé'
    expect(sanitizeTerminalText(text)).toBe(text)
  })

  it('strips an OSC 52 clipboard write (BEL- and ST-terminated)', () => {
    expect(sanitizeTerminalText(`a${OSC52}b`)).toBe('ab')
    expect(sanitizeTerminalText('a\x1b]52;c;Zm9v\x1b\\b')).toBe('ab')
  })

  it('strips CSI screen/cursor control and device queries', () => {
    expect(sanitizeTerminalText('a\x1b[2J\x1b[Hb\x1b[6nc')).toBe('abc')
  })

  it('strips SGR by default', () => {
    expect(sanitizeTerminalText('\x1b[31mred\x1b[0m')).toBe('red')
  })

  it('strips DCS/APC strings, two-byte escapes, and a lone ESC', () => {
    expect(sanitizeTerminalText('a\x1bP1$qm\x1b\\b\x1b_apc\x07c\x1bcd\x1b')).toBe('abcd')
  })

  it('drops only the introducer of an unterminated OSC, leaving its payload as inert text', () => {
    expect(sanitizeTerminalText('a\x1b]0;evil')).toBe('a0;evil')
  })

  it('strips C0 (except tab/newline), DEL, and C1 bytes, including 8-bit CSI/OSC', () => {
    expect(sanitizeTerminalText('a\x07b\x08c\x7fd\x9b31me\x9df')).toBe('abcd31mef')
  })

  it('normalizes CRLF and drops a lone CR so nothing an overwrite would hide stays hidden', () => {
    expect(sanitizeTerminalText('one\r\ntwo\rthree')).toBe('one\ntwothree')
  })

  describe('terminalOutput', () => {
    it('keeps SGR colors but strips everything else', () => {
      expect(sanitizeTerminalText('\x1b[32mok\x1b[0m\x1b[2J', { terminalOutput: true })).toBe('\x1b[32mok\x1b[0m')
    })

    it('resolves carriage-return progress redraws to the final segment', () => {
      expect(sanitizeTerminalText('10%\r50%\r100%\ndone\r\n', { terminalOutput: true })).toBe('100%\ndone\n')
    })
  })
})

describe('sanitizeTitle', () => {
  it('flattens to one control-free line', () => {
    expect(sanitizeTitle('fix\x07\x1b]0;pwned\x07 the\n\tbug ')).toBe('fix the bug')
  })

  it('caps length', () => {
    expect(sanitizeTitle('x'.repeat(500))).toHaveLength(120)
  })
})

describe('sanitizeDeep', () => {
  it('sanitizes nested strings without mutating the input', () => {
    const input = { a: ['x\x1b[2Jy', { b: 'ok' }], n: 1 }
    const output = sanitizeDeep(input)
    expect(output).toEqual({ a: ['xy', { b: 'ok' }], n: 1 })
    expect(input.a[0]).toBe('x\x1b[2Jy')
  })

  it('preserves identity of clean subtrees', () => {
    const clean = { b: 'ok' }
    const input = { dirty: 'a\x07', clean }
    expect(sanitizeDeep(input).clean).toBe(clean)
    const allClean = { x: ['y'] }
    expect(sanitizeDeep(allClean)).toBe(allClean)
  })

  it('leaves class instances alone', () => {
    const date = new Date(0)
    expect(sanitizeDeep({ date }).date).toBe(date)
  })
})

describe('safeHyperlinkUrl', () => {
  it('accepts http, https, and mailto', () => {
    expect(safeHyperlinkUrl('https://example.com/a?b=c')).toBe('https://example.com/a?b=c')
    expect(safeHyperlinkUrl('mailto:a@example.com')).toBe('mailto:a@example.com')
  })

  it('rejects other schemes, relative URLs, and control bytes', () => {
    expect(safeHyperlinkUrl('javascript:alert(1)')).toBeUndefined()
    expect(safeHyperlinkUrl('file:///etc/passwd')).toBeUndefined()
    expect(safeHyperlinkUrl('/relative')).toBeUndefined()
    expect(safeHyperlinkUrl('https://example.com/\x1b\\x')).toBeUndefined()
  })
})

describe('renderer integration', () => {
  it('drops the OSC 8 wrapper for an unsafe link but keeps the label', () => {
    const out = renderMarkdown('see [here](javascript:alert(1)) now')
    expect(out).not.toContain('\x1b]8;;javascript')
    expect(out).toContain('here')
  })

  it('still hyperlinks a safe link', () => {
    expect(renderMarkdown('see [here](https://example.com)')).toContain('\x1b]8;;https://example.com\x1b\\')
  })

  it('strips escapes from settled assistant text', () => {
    const event = { type: 'assistant/message', seq: 1, time: 0, data: { message: { content: [{ type: 'text', text: `hi${OSC52}` }] } } } as unknown as SessionEvent
    expect(formatEvent(event, { replay: false })).not.toContain('\x1b]52')
  })

  it('strips escapes from streaming text, including one completed across deltas', () => {
    const first = 'hello \x1b]52;c;Zm9v'
    expect(formatStreamingText(first)).not.toContain('\x1b]')
    expect(formatStreamingText(`${first}\x07 world`)).not.toContain('\x1b]')
  })

  it('strips escapes from a tool result read from a hostile file', () => {
    const event = {
      type: 'tool/result',
      seq: 1,
      time: 0,
      data: { message: { source: { kind: 'tool', callId: 'c1' }, content: [{ type: 'text', text: `line${OSC52}` }], isError: false } },
    } as unknown as SessionEvent
    expect(formatToolCardDetail(event, { replay: false }).join('\n')).not.toContain('\x1b]52')
  })

  it('keeps shell-mode colors but strips screen control', () => {
    const out = formatShellRun('ls', '\x1b[34mdir\x1b[0m\x1b[2J\n', 0)
    expect(out).toContain('\x1b[34mdir')
    expect(out).not.toContain('\x1b[2J')
  })

  it('cannot break out of the OSC 0 terminal title', () => {
    expect(buildTerminalTitle('ok\x07\x1b]52;c;Zm9v\x07')).toBe('ok — dsh-tui')
  })
})

describe('TuiStore sanitization', () => {
  it('sanitizes seeded and appended events, including pending tool-call names', () => {
    const seeded = { type: 'user/message', seq: 1, time: 0, data: { source: { kind: 'user' }, content: [{ type: 'text', text: `a${OSC52}` }] } } as unknown as SessionEvent
    const call = { type: 'tool/call', seq: 2, time: 0, data: { turn: 1, step: 1, callId: 'c1', name: 'x\x1b[2J', arguments: '{}' } } as unknown as SessionEvent
    const store = new TuiStore({ events: [seeded] })
    store.appendEvent(call)
    const { events, pendingToolCalls } = store.getSnapshot()
    expect(JSON.stringify(events)).not.toContain('\\u001b')
    expect(pendingToolCalls[0].name).toBe('x')
  })

  it('sanitizes the session title and notices', () => {
    const store = new TuiStore({ events: [] })
    store.setTitle('t\x07itle')
    store.setNotice('err\x1b[2J')
    expect(store.getSnapshot().title).toBe('title')
    expect(store.getSnapshot().notice).toBe('err')
  })
})
