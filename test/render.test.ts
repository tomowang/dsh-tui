import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ToolCallView, ToolDefinition, ToolResultView } from '@deepseek-ai/dsh-tools'
import { formatEvent, formatShellRun, formatShellRunLive, formatStreamingText, truncate, type RenderOptions } from '../src/render.js'

/** Build a minimal event fixture; formatEvent only ever reads `.type`/`.data`. */
function event(type: string, data: unknown): SessionEvent {
  return { type, seq: 1, time: 0, data } as unknown as SessionEvent
}

/** A `ToolDefinition` with only the presentation methods a test needs; other fields are never read. */
function fakeTool(overrides: Partial<Pick<ToolDefinition, 'presentCall' | 'presentResult'>>): ToolDefinition {
  return overrides as unknown as ToolDefinition
}

/** A `getTool` resolver serving one named tool. */
function toolResolver(name: string, tool: ToolDefinition): RenderOptions['getTool'] {
  return toolName => (toolName === name ? tool : undefined)
}

/** A `getToolCall` resolver serving one `callId -> {name, arguments}` pair. */
function callResolver(callId: string, call: { name: string; arguments: string }): RenderOptions['getToolCall'] {
  return id => (id === callId ? call : undefined)
}

/** A `tool/result` event fixture whose `message.source.callId` correlates back to its `tool/call`. */
function resultEvent(callId: string, content: unknown[], isError: boolean): SessionEvent {
  return event('tool/result', {
    message: { source: { kind: 'tool', callId }, content: [{ type: 'tool-result', content, isError }] },
  })
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
  it('includes the tool name and truncated arguments when no getTool is supplied', () => {
    const line = formatEvent(
      event('tool/call', { name: 'read_file', arguments: '{"path":"/tmp/foo.txt"}' }),
      { replay: false },
    )
    expect(line).toContain('read_file')
    expect(line).toContain('/tmp/foo.txt')
  })

  it('falls back to the flat line when the tool has no presentCall', () => {
    const line = formatEvent(
      event('tool/call', { name: 'read_file', arguments: '{"path":"/tmp/foo.txt"}' }),
      { replay: false, getTool: toolResolver('read_file', fakeTool({})) },
    )
    expect(line).toContain('read_file')
    expect(line).toContain('/tmp/foo.txt')
  })

  it('falls back to the flat line when presentCall returns undefined', () => {
    const tool = fakeTool({ presentCall: () => undefined })
    const line = formatEvent(
      event('tool/call', { name: 'read_file', arguments: '{"path":"/tmp/foo.txt"}' }),
      { replay: false, getTool: toolResolver('read_file', tool) },
    )
    expect(line).toContain('read_file')
    expect(line).toContain('/tmp/foo.txt')
  })

  it('falls back to the flat line when presentCall throws', () => {
    const tool = fakeTool({
      presentCall: () => {
        throw new Error('boom')
      },
    })
    const line = formatEvent(
      event('tool/call', { name: 'read_file', arguments: '{"path":"/tmp/foo.txt"}' }),
      { replay: false, getTool: toolResolver('read_file', tool) },
    )
    expect(line).toContain('read_file')
    expect(line).toContain('/tmp/foo.txt')
  })

  it('falls back to the flat line when the arguments are not valid JSON', () => {
    const tool = fakeTool({ presentCall: () => ({ card: 'generic', title: 'should not be reached' }) })
    const line = formatEvent(
      event('tool/call', { name: 'read_file', arguments: 'not json' }),
      { replay: false, getTool: toolResolver('read_file', tool) },
    )
    expect(line).toContain('read_file')
    expect(line).not.toContain('should not be reached')
  })

  it('renders a generic card as a single line when there is no rawInput', () => {
    const view: ToolCallView = { card: 'generic', title: 'Read src/foo.ts', kind: 'read' }
    const tool = fakeTool({ presentCall: () => view })
    const line = formatEvent(
      event('tool/call', { name: 'read_file', arguments: '{"path":"src/foo.ts"}' }),
      { replay: false, getTool: toolResolver('read_file', tool) },
    )
    expect(line).toContain('Read src/foo.ts')
    expect(line?.includes('\n')).toBe(false)
  })

  it('renders a generic card with rawInput on a following line', () => {
    const view: ToolCallView = { card: 'generic', title: 'Run background job', rawInput: 'job-42' }
    const tool = fakeTool({ presentCall: () => view })
    const line = formatEvent(
      event('tool/call', { name: 'run_job', arguments: '{}' }),
      { replay: false, getTool: toolResolver('run_job', tool) },
    )
    expect(line).toContain('Run background job')
    expect(line).toContain('job-42')
  })

  it('renders a terminal card with its command, description, and cwd', () => {
    const view: ToolCallView = { card: 'terminal', title: 'ls -la', description: 'List files', cwd: '/home/user' }
    const tool = fakeTool({ presentCall: () => view })
    const line = formatEvent(
      event('tool/call', { name: 'bash', arguments: '{"command":"ls -la"}' }),
      { replay: false, getTool: toolResolver('bash', tool) },
    )
    expect(line).toContain('List files')
    expect(line).toContain('ls -la')
    expect(line).toContain('/home/user')
  })

  it('renders a diff card with +/- lines for a new file', () => {
    const view: ToolCallView = {
      card: 'diff',
      title: 'Write foo.txt',
      diffs: [{ path: 'foo.txt', oldText: null, newText: 'line one\nline two' }],
    }
    const tool = fakeTool({ presentCall: () => view })
    const line = formatEvent(
      event('tool/call', { name: 'write', arguments: '{"path":"foo.txt","content":"line one\\nline two"}' }),
      { replay: false, getTool: toolResolver('write', tool) },
    )
    expect(line).toContain('Write foo.txt')
    expect(line).toContain('foo.txt')
    expect(line).toContain('+ line one')
    expect(line).toContain('+ line two')
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
        message: {
          source: { kind: 'tool', callId: 'call-1' },
          content: [{ type: 'tool-result', content: [{ type: 'text', text: 'permission denied' }], isError: true }],
        },
      }),
      { replay: false },
    )
    expect(line).toContain('✖')
    expect(line).toContain('permission denied')
  })

  it('shows the success icon when the block does not report isError', () => {
    const line = formatEvent(
      event('tool/result', {
        message: {
          source: { kind: 'tool', callId: 'call-1' },
          content: [{ type: 'tool-result', content: [{ type: 'text', text: 'ok' }], isError: false }],
        },
      }),
      { replay: false },
    )
    expect(line).toContain('✓')
    expect(line).toContain('ok')
  })

  it('renders a bare icon with no trailing content for an empty result', () => {
    const line = formatEvent(
      event('tool/result', {
        message: {
          source: { kind: 'tool', callId: 'call-1' },
          content: [{ type: 'tool-result', content: [], isError: false }],
        },
      }),
      { replay: false },
    )
    expect(line?.trim()).toBe(line)
    expect(line).toContain('✓')
  })

  it('bypasses presentation for an internal error even with getTool/getToolCall supplied', () => {
    const tool = fakeTool({ presentResult: () => ({ card: 'generic', title: 'should not be reached' }) })
    const line = formatEvent(
      event('tool/result', {
        error: { code: 'E_TIMEOUT', name: 'ToolTimeoutError' },
        message: {
          source: { kind: 'tool', callId: 'call-1' },
          content: [{ type: 'tool-result', content: [], isError: false }],
        },
      }),
      {
        replay: false,
        getTool: toolResolver('read_file', tool),
        getToolCall: callResolver('call-1', { name: 'read_file', arguments: '{}' }),
      },
    )
    expect(line).toContain('E_TIMEOUT')
    expect(line).not.toContain('should not be reached')
  })

  it('falls back to the flat line when getToolCall has no matching call', () => {
    const line = formatEvent(
      resultEvent('call-1', [{ type: 'text', text: 'ok' }], false),
      { replay: false, getToolCall: callResolver('call-2', { name: 'read_file', arguments: '{}' }) },
    )
    expect(line).toContain('✓')
    expect(line).toContain('ok')
  })

  it('falls back to the flat line when the tool has no presentResult', () => {
    const line = formatEvent(
      resultEvent('call-1', [{ type: 'text', text: 'ok' }], false),
      {
        replay: false,
        getTool: toolResolver('read_file', fakeTool({})),
        getToolCall: callResolver('call-1', { name: 'read_file', arguments: '{}' }),
      },
    )
    expect(line).toContain('✓')
    expect(line).toContain('ok')
  })

  it('falls back to the flat line when presentResult returns undefined', () => {
    const tool = fakeTool({ presentResult: () => undefined })
    const line = formatEvent(
      resultEvent('call-1', [{ type: 'text', text: 'ok' }], false),
      {
        replay: false,
        getTool: toolResolver('read_file', tool),
        getToolCall: callResolver('call-1', { name: 'read_file', arguments: '{}' }),
      },
    )
    expect(line).toContain('✓')
    expect(line).toContain('ok')
  })

  it('falls back to the flat line when presentResult throws', () => {
    const tool = fakeTool({
      presentResult: () => {
        throw new Error('boom')
      },
    })
    const line = formatEvent(
      resultEvent('call-1', [{ type: 'text', text: 'ok' }], false),
      {
        replay: false,
        getTool: toolResolver('read_file', tool),
        getToolCall: callResolver('call-1', { name: 'read_file', arguments: '{}' }),
      },
    )
    expect(line).toContain('✓')
    expect(line).toContain('ok')
  })

  it('falls back to the flat line when the correlated call has malformed arguments', () => {
    const tool = fakeTool({ presentResult: () => ({ card: 'generic', title: 'should not be reached' }) })
    const line = formatEvent(
      resultEvent('call-1', [{ type: 'text', text: 'ok' }], false),
      {
        replay: false,
        getTool: toolResolver('read_file', tool),
        getToolCall: callResolver('call-1', { name: 'read_file', arguments: 'not json' }),
      },
    )
    expect(line).toContain('✓')
    expect(line).not.toContain('should not be reached')
  })

  it('renders a generic card with a replacement title and reformatted content', () => {
    const view: ToolResultView = { card: 'generic', title: 'Read src/foo.ts', content: [{ type: 'text', text: '1: hello' }] }
    const tool = fakeTool({ presentResult: () => view })
    const line = formatEvent(
      resultEvent('call-1', [{ type: 'text', text: 'raw' }], false),
      {
        replay: false,
        getTool: toolResolver('read_file', tool),
        getToolCall: callResolver('call-1', { name: 'read_file', arguments: '{}' }),
      },
    )
    expect(line).toContain('Read src/foo.ts')
    expect(line).toContain('1: hello')
    expect(line).not.toContain('raw')
  })

  it('renders a terminal card with output and exit code', () => {
    const view: ToolResultView = { card: 'terminal', output: 'total 0\ndrwx------', exitCode: 0 }
    const tool = fakeTool({ presentResult: () => view })
    const line = formatEvent(
      resultEvent('call-1', [{ type: 'text', text: 'raw' }], false),
      {
        replay: false,
        getTool: toolResolver('bash', tool),
        getToolCall: callResolver('call-1', { name: 'bash', arguments: '{"command":"ls -la"}' }),
      },
    )
    expect(line).toContain('total 0')
    expect(line).toContain('drwx------')
    expect(line).toContain('[exit 0]')
  })

  it('renders a diff card from the completed FileDiffs', () => {
    const view: ToolResultView = {
      card: 'diff',
      title: 'Write foo.txt',
      diffs: [{ path: 'foo.txt', oldText: 'old', newText: 'new' }],
    }
    const tool = fakeTool({ presentResult: () => view })
    const line = formatEvent(
      resultEvent('call-1', [{ type: 'text', text: 'raw' }], false),
      {
        replay: false,
        getTool: toolResolver('write', tool),
        getToolCall: callResolver('call-1', { name: 'write', arguments: '{}' }),
      },
    )
    expect(line).toContain('Write foo.txt')
    expect(line).toContain('- old')
    expect(line).toContain('+ new')
  })

  it('renders a search card grouped by file, with a truncated footer', () => {
    const view: ToolResultView = {
      card: 'search',
      shape: 'matches',
      files: [{ path: 'src/a.ts', matches: [{ lineNumber: 3, line: 'const x = 1' }] }],
      truncated: true,
      total: 50,
    }
    const tool = fakeTool({ presentResult: () => view })
    const line = formatEvent(
      resultEvent('call-1', [{ type: 'text', text: 'raw' }], false),
      {
        replay: false,
        getTool: toolResolver('grep', tool),
        getToolCall: callResolver('call-1', { name: 'grep', arguments: '{}' }),
      },
    )
    expect(line).toContain('src/a.ts')
    expect(line).toContain('3: const x = 1')
    expect(line).toContain('1 of 50')
  })

  it('renders a read card as numbered lines with a window summary', () => {
    const view: ToolResultView = {
      card: 'read',
      path: 'src/a.ts',
      offset: 1,
      lines: [{ number: 1, text: 'const x = 1' }],
      totalLines: 200,
    }
    const tool = fakeTool({ presentResult: () => view })
    const line = formatEvent(
      resultEvent('call-1', [{ type: 'text', text: 'raw' }], false),
      {
        replay: false,
        getTool: toolResolver('read_file', tool),
        getToolCall: callResolver('call-1', { name: 'read_file', arguments: '{}' }),
      },
    )
    expect(line).toContain('src/a.ts')
    expect(line).toContain('1: const x = 1')
    expect(line).toContain('1-1 of 200')
  })

  it('renders a web search card with citations', () => {
    const view: ToolResultView = {
      card: 'web',
      kind: 'search',
      sources: [{ url: 'https://example.com', title: 'Example' }],
      truncated: false,
    }
    const tool = fakeTool({ presentResult: () => view })
    const line = formatEvent(
      resultEvent('call-1', [{ type: 'text', text: 'raw' }], false),
      {
        replay: false,
        getTool: toolResolver('web_search', tool),
        getToolCall: callResolver('call-1', { name: 'web_search', arguments: '{}' }),
      },
    )
    expect(line).toContain('Example')
    expect(line).toContain('https://example.com')
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

describe('formatShellRun', () => {
  it('includes the command, output, and a clean exit code', () => {
    const line = formatShellRun('ls', 'a.txt\nb.txt\n', 0)
    expect(line).toContain('ls')
    expect(line).toContain('a.txt')
    expect(line).toContain('b.txt')
    expect(line).toContain('[exit 0]')
  })

  it('omits the output section for an empty-output run', () => {
    const line = formatShellRun('true', '', 0)
    expect(line.split('\n').filter(l => l !== '')).toHaveLength(2)
  })
})

describe('formatShellRunLive', () => {
  it('shows the command and accumulated output without an exit line', () => {
    const line = formatShellRunLive('ls', 'a.txt\n')
    expect(line).toContain('ls')
    expect(line).toContain('a.txt')
    expect(line).not.toContain('[exit')
  })
})
