import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { formatEvent, formatStreamingText, truncate } from '../src/render.js'

/** Build a minimal event fixture; formatEvent only ever reads `.type`/`.data`. */
function event(type: string, data: unknown): SessionEvent {
  return { type, seq: 1, time: 0, data } as unknown as SessionEvent
}

describe('truncate', () => {
  it('leaves short text untouched', () => {
    expect(truncate('hello', 100)).toBe('hello')
  })

  it('collapses embedded newlines to spaces', () => {
    expect(truncate('a\nb\nc', 100)).toBe('a b c')
  })

  it('truncates with an ellipsis over the limit', () => {
    const result = truncate('abcdefghij', 5)
    expect(result).toHaveLength(5)
    expect(result.endsWith('…')).toBe(true)
    expect(result).toBe('abcd…')
  })
})

describe('formatEvent — user/message', () => {
  it('renders a direct human prompt in full', () => {
    const line = formatEvent(
      event('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: 'hello there' }] }),
      { replay: false },
    )
    expect(line).toContain('you ›')
    expect(line).toContain('hello there')
  })

  it('renders nothing for an empty human prompt', () => {
    const line = formatEvent(
      event('user/message', { source: { kind: 'user' }, content: [] }),
      { replay: false },
    )
    expect(line).toBeUndefined()
  })

  it('collapses a plugin-injected notice to a summary line', () => {
    const line = formatEvent(
      event('user/message', {
        source: { kind: 'plugin', plugin: 'skill-loader', form: 'notice', summary: 'loaded 3 skills' },
        content: [{ type: 'text', text: 'irrelevant, never shown' }],
      }),
      { replay: false },
    )
    expect(line).toContain('⊕ context ›')
    expect(line).toContain('skill-loader')
    expect(line).toContain('loaded 3 skills')
    expect(line).not.toContain('irrelevant')
  })

  it('omits the summary for a plugin source with no notice form', () => {
    const line = formatEvent(
      event('user/message', {
        source: { kind: 'plugin', plugin: 'agents-md', form: 'context' },
        content: [{ type: 'text', text: 'irrelevant' }],
      }),
      { replay: false },
    )
    expect(line).toContain('agents-md')
    expect(line).not.toContain('·')
  })

  it('falls back to a generic label for an unrecognized source kind', () => {
    const line = formatEvent(
      event('user/message', { source: { kind: 'tool' }, content: [] }),
      { replay: false },
    )
    expect(line).toContain('⊕ context ›')
    expect(line).toContain('tool')
  })
})

describe('formatEvent — assistant/message', () => {
  it('joins text blocks wrapped in leading/trailing newlines', () => {
    const line = formatEvent(
      event('assistant/message', { message: { content: [{ type: 'text', text: 'part one' }, { type: 'text', text: ' part two' }] } }),
      { replay: false },
    )
    expect(line).toBe('\npart one part two\n')
  })

  it('renders nothing for empty content', () => {
    const line = formatEvent(
      event('assistant/message', { message: { content: [] } }),
      { replay: false },
    )
    expect(line).toBeUndefined()
  })
})

describe('formatStreamingText', () => {
  it('mirrors assistant/message framing for non-empty text', () => {
    expect(formatStreamingText('Hello')).toBe('\nHello\n')
  })

  it('renders nothing for empty text', () => {
    expect(formatStreamingText('')).toBeUndefined()
  })
})

describe('formatEvent — tool/call', () => {
  it('includes the tool name and truncated arguments', () => {
    const line = formatEvent(
      event('tool/call', { name: 'read_file', arguments: '{"path":"/tmp/foo.txt"}' }),
      { replay: false },
    )
    expect(line).toContain('read_file')
    expect(line).toContain('/tmp/foo.txt')
  })
})

describe('formatEvent — tool/result', () => {
  it('shows an internal harness-level error, independent of the block', () => {
    const line = formatEvent(
      event('tool/result', {
        error: { code: 'E_TIMEOUT', name: 'ToolTimeoutError' },
        message: { content: [{ type: 'tool-result', content: [{ type: 'text', text: 'ignored' }], isError: false }] },
      }),
      { replay: false },
    )
    expect(line).toContain('E_TIMEOUT')
    expect(line).toContain('ToolTimeoutError')
    expect(line).not.toContain('ignored')
  })

  it('shows the failure icon when the block reports isError', () => {
    const line = formatEvent(
      event('tool/result', {
        message: { content: [{ type: 'tool-result', content: [{ type: 'text', text: 'permission denied' }], isError: true }] },
      }),
      { replay: false },
    )
    expect(line).toContain('✖')
    expect(line).toContain('permission denied')
  })

  it('shows the success icon when the block does not report isError', () => {
    const line = formatEvent(
      event('tool/result', {
        message: { content: [{ type: 'tool-result', content: [{ type: 'text', text: 'ok' }], isError: false }] },
      }),
      { replay: false },
    )
    expect(line).toContain('✓')
    expect(line).toContain('ok')
  })

  it('renders a bare icon with no trailing content for an empty result', () => {
    const line = formatEvent(
      event('tool/result', {
        message: { content: [{ type: 'tool-result', content: [], isError: false }] },
      }),
      { replay: false },
    )
    expect(line?.trim()).toBe(line)
    expect(line).toContain('✓')
  })
})

describe('formatEvent — turn/end', () => {
  it('renders an error reason', () => {
    const line = formatEvent(
      event('turn/end', { reason: { kind: 'error', error: { code: 'E_BOOM', message: 'it broke' } } }),
      { replay: false },
    )
    expect(line).toContain('E_BOOM')
    expect(line).toContain('it broke')
  })

  it('renders an aborted reason', () => {
    const line = formatEvent(event('turn/end', { reason: { kind: 'aborted' } }), { replay: false })
    expect(line).toContain('turn canceled')
  })

  it('renders nothing for other reason kinds', () => {
    const line = formatEvent(event('turn/end', { reason: { kind: 'completed' } }), { replay: false })
    expect(line).toBeUndefined()
  })
})

describe('formatEvent — compaction/summary', () => {
  it('reports the shadowed item and token counts', () => {
    const line = formatEvent(
      event('compaction/summary', { shadowedSeqs: [1, 2, 3], shadowedTokenCount: 456 }),
      { replay: false },
    )
    expect(line).toContain('3 items')
    expect(line).toContain('456 tokens')
  })
})

describe('formatEvent — compaction/end', () => {
  it('renders nothing on a clean end', () => {
    const line = formatEvent(event('compaction/end', {}), { replay: false })
    expect(line).toBeUndefined()
  })

  it('renders the error when compaction did not finish cleanly', () => {
    const line = formatEvent(event('compaction/end', { error: 'commit failed' }), { replay: false })
    expect(line).toContain('compaction')
    expect(line).toContain('commit failed')
  })
})

describe('formatEvent — unhandled types', () => {
  it('falls through to undefined for a merge-extensible type this viewer does not present', () => {
    const line = formatEvent(event('todo/write', { todos: [] }), { replay: false })
    expect(line).toBeUndefined()
  })
})
