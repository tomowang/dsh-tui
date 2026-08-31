import { describe, expect, it } from 'vitest'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { buildAgentDetailLines, buildToolCallLookup } from '../../../src/tui/agents/detailLines.js'

// eslint-disable-next-line no-control-regex -- stripping color codes to assert on this test's own plain-text shape.
const ANSI_RE = /\x1b\[[0-9;]*m/g
const strip = (lines: readonly string[]): string[] => lines.map(line => line.replace(ANSI_RE, ''))

/** Build a minimal event fixture; both functions under test only ever read `.type`/`.data`. */
function event(type: string, data: unknown): SessionEvent {
  return { type, seq: 1, time: 0, data } as unknown as SessionEvent
}

function userMessage(text: string): SessionEvent {
  return event('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text }] })
}

function toolCallEvent(callId: string, name: string, args: string): SessionEvent {
  return event('tool/call', { callId: ToolCallId(callId), name, arguments: args })
}

describe('buildToolCallLookup', () => {
  it("maps a tool/call event's callId to its name and arguments", () => {
    const lookup = buildToolCallLookup([toolCallEvent('c1', 'read_file', '{"path":"a.ts"}')])
    expect(lookup.get(ToolCallId('c1'))).toEqual({ name: 'read_file', arguments: '{"path":"a.ts"}' })
  })

  it('ignores non tool/call events', () => {
    expect(buildToolCallLookup([event('turn/start', { turn: 1 }), userMessage('hi')]).size).toBe(0)
  })

  it('has no entry for a callId absent from the given log', () => {
    const lookup = buildToolCallLookup([toolCallEvent('c1', 'read_file', '{}')])
    expect(lookup.get(ToolCallId('c2'))).toBeUndefined()
  })

  it('returns an empty map for an empty log', () => {
    expect(buildToolCallLookup([]).size).toBe(0)
  })
})

describe('buildAgentDetailLines', () => {
  it('renders one line for a single-line event', () => {
    expect(strip(buildAgentDetailLines([userMessage('fix the auth bug')], undefined))).toEqual(['you › fix the auth bug'])
  })

  it('renders multiple events in log order', () => {
    const events = [userMessage('first'), userMessage('second')]
    expect(strip(buildAgentDetailLines(events, undefined))).toEqual(['you › first', 'you › second'])
  })

  it('splits one multi-line formatted event into separate lines', () => {
    const events = [userMessage('line one\nline two')]
    expect(strip(buildAgentDetailLines(events, undefined))).toEqual(['you › line one', 'line two'])
  })

  it('drops an event formatEvent has nothing to show for', () => {
    // tool/call never gets its own transcript line (see render.ts) — only its paired tool/result does.
    expect(buildAgentDetailLines([toolCallEvent('c1', 'read_file', '{}')], undefined)).toEqual([])
  })

  it('drops a user/message with empty text instead of an empty line', () => {
    expect(buildAgentDetailLines([userMessage('')], undefined)).toEqual([])
  })

  it('returns an empty array for an empty log', () => {
    expect(buildAgentDetailLines([], undefined)).toEqual([])
  })
})
