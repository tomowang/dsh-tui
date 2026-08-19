import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { buildTrajectoryRows } from '../../../src/tui/trajectory/layout.js'
import type { TrajectoryRow } from '../../../src/tui/trajectory/types.js'

/** Build a minimal event fixture; buildTrajectoryRows only ever reads `.type`/`.seq`/`.time`/`.data`. */
function event(type: string, seq: number, data: unknown): SessionEvent {
  return { type, seq, time: seq * 1000, data } as unknown as SessionEvent
}

function fixtureEvents(): SessionEvent[] {
  return [
    event('turn/start', 1, { turn: 1 }),
    event('step/start', 2, { turn: 1, step: 1 }),
    event('user/message', 3, { source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] }),
    event('assistant/message', 4, { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'sure' }] } }),
    event('tool/call', 5, { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: '{"cmd":"ls"}' }),
    event('tool/result', 6, {
      turn: 1,
      step: 1,
      message: {
        content: [{ type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: 'file.txt' }], isError: false }],
        source: { kind: 'tool', callId: 'c1' },
      },
    }),
    event('turn/end', 7, { turn: 1, reason: { kind: 'completed' } }),
    event('turn/start', 8, { turn: 2 }),
    event('step/start', 9, { turn: 2, step: 1 }),
    event('tool/call', 10, { turn: 2, step: 1, callId: 'c2', name: 'write', arguments: '{}' }),
    event('tool/result', 11, {
      turn: 2,
      step: 1,
      message: {
        content: [{ type: 'tool-result', toolCallId: 'c2', content: [{ type: 'text', text: 'denied' }], isError: true }],
        source: { kind: 'tool', callId: 'c2' },
      },
    }),
    event('turn/end', 12, { turn: 2, reason: { kind: 'aborted', reason: { kind: 'user' } } }),
  ]
}

function recordRows(rows: readonly TrajectoryRow[]) {
  return rows.filter((row): row is Extract<TrajectoryRow, { kind: 'record' }> => row.kind === 'record')
}

describe('buildTrajectoryRows', () => {
  it('emits a turn row per turn/start', () => {
    const rows = buildTrajectoryRows(fixtureEvents(), new Set())
    const turnRows = rows.filter(row => row.kind === 'turn')
    expect(turnRows.map(row => row.turn)).toEqual([1, 2])
  })

  it('drops step rows for single-step turns', () => {
    const rows = buildTrajectoryRows(fixtureEvents(), new Set())
    expect(rows.some(row => row.kind === 'step')).toBe(false)
  })

  it('projects one record each for user, assistant, and a paired tool call/result', () => {
    const rows = buildTrajectoryRows(fixtureEvents(), new Set())
    const records = recordRows(rows)
    const kinds = records.map(row => row.record.kind)
    expect(kinds).toEqual(['user', 'assistant', 'tool', 'tool'])
  })

  it('pairs tool/call with tool/result by callId, carrying result text and completion time', () => {
    const rows = buildTrajectoryRows(fixtureEvents(), new Set())
    const call = recordRows(rows).find(row => row.record.id === 'c1')
    expect(call).toBeDefined()
    expect(call?.record.isError).toBe(false)
    expect(call?.record.result).toBe('file.txt')
    expect(call?.record.completedAt).toBe(6000)
  })

  it('marks a failed tool result as an error', () => {
    const rows = buildTrajectoryRows(fixtureEvents(), new Set())
    const call = recordRows(rows).find(row => row.record.id === 'c2')
    expect(call?.record.isError).toBe(true)
    expect(call?.record.result).toBe('denied')
  })

  it('carries the tool name on a call record, for the Schema tab lookup', () => {
    const rows = buildTrajectoryRows(fixtureEvents(), new Set())
    const call = recordRows(rows).find(row => row.record.id === 'c1')
    expect(call?.record.toolName).toBe('bash')
  })

  it('leaves toolName undefined for a user/assistant record', () => {
    const rows = buildTrajectoryRows(fixtureEvents(), new Set())
    const kinds = recordRows(rows).filter(row => row.record.kind === 'user' || row.record.kind === 'assistant')
    for (const row of kinds) expect(row.record.toolName).toBeUndefined()
  })

  it('attaches an abort note to the turn row on a canceled turn', () => {
    const rows = buildTrajectoryRows(fixtureEvents(), new Set())
    const turn2 = rows.find(row => row.kind === 'turn' && row.turn === 2)
    expect(turn2).toMatchObject({ kind: 'turn', turn: 2, aborted: 'turn canceled' })
  })

  it('leaves a completed turn with no abort note', () => {
    const rows = buildTrajectoryRows(fixtureEvents(), new Set())
    const turn1 = rows.find(row => row.kind === 'turn' && row.turn === 1)
    expect(turn1).toMatchObject({ kind: 'turn', turn: 1, aborted: undefined })
  })

  it('classifies a plugin-injected user/message as a context record with a collapsed label', () => {
    const rows = buildTrajectoryRows(
      [
        event('turn/start', 1, { turn: 1 }),
        event('user/message', 2, {
          source: { kind: 'plugin', plugin: 'skill-loader', form: 'notice', summary: 'loaded foo skill' },
          content: [{ type: 'text', text: 'full skill body' }],
        }),
      ],
      new Set(),
    )
    const record = recordRows(rows)[0]?.record
    expect(record?.kind).toBe('context')
    // The one-line ledger label stays collapsed to the plugin/summary tag...
    expect(record?.label).toBe('skill-loader · loaded foo skill')
    // ...but `payload` (reached only via the Preview/Raw tabs, not the
    // ledger row itself) carries the full injected content, matching the
    // web ledger.
    expect(record?.payload).toBe('full skill body')
    expect(record?.source).toEqual({ kind: 'plugin', plugin: 'skill-loader', form: 'notice', summary: 'loaded foo skill' })
  })

  it('carries source for a direct human prompt too, not just injected context', () => {
    const rows = buildTrajectoryRows(fixtureEvents(), new Set())
    const record = recordRows(rows).find(row => row.record.kind === 'user')?.record
    expect(record?.source).toEqual({ kind: 'user' })
  })

  it('falls back to a reasoning preview for an assistant message with only thinking and tool calls', () => {
    const rows = buildTrajectoryRows(
      [
        event('turn/start', 1, { turn: 1 }),
        event('assistant/message', 2, {
          turn: 1,
          step: 1,
          message: { content: [{ type: 'reasoning', text: 'let me check the file first' }] },
        }),
      ],
      new Set(),
    )
    const assistant = recordRows(rows).find(row => row.record.kind === 'assistant')
    expect(assistant?.record.label).toBe('let me check the file first')
    // The label falls back to reasoning for display, but `payload` (visible
    // text) and `reasoning` stay distinct so the Preview/Raw tabs can show
    // both when present — see `layout.ts`'s `assistant/message` case.
    expect(assistant?.record.payload).toBeUndefined()
    expect(assistant?.record.reasoning).toBe('let me check the file first')
  })

  it('still labels an assistant message "(tool calls only)" with neither text nor reasoning', () => {
    const rows = buildTrajectoryRows(
      [
        event('turn/start', 1, { turn: 1 }),
        event('assistant/message', 2, {
          turn: 1,
          step: 1,
          message: { content: [{ type: 'tool-call', toolCallId: 'c1', name: 'bash', arguments: '{}' }] },
        }),
      ],
      new Set(),
    )
    const assistant = recordRows(rows).find(row => row.record.kind === 'assistant')
    expect(assistant?.record.label).toBe('(tool calls only)')
    expect(assistant?.record.payload).toBeUndefined()
  })

  it('prefers visible text over reasoning when both are present', () => {
    const rows = buildTrajectoryRows(
      [
        event('turn/start', 1, { turn: 1 }),
        event('assistant/message', 2, {
          turn: 1,
          step: 1,
          message: {
            content: [
              { type: 'reasoning', text: 'thinking it through' },
              { type: 'text', text: 'the answer' },
            ],
          },
        }),
      ],
      new Set(),
    )
    const assistant = recordRows(rows).find(row => row.record.kind === 'assistant')
    expect(assistant?.record.label).toBe('the answer')
    // Unlike the label, `payload` and `reasoning` don't collapse into one
    // another — both are kept for the Preview/Raw tabs.
    expect(assistant?.record.payload).toBe('the answer')
    expect(assistant?.record.reasoning).toBe('thinking it through')
  })

  it('folds a collapsed turn to its first record plus a summary row', () => {
    const rows = buildTrajectoryRows(fixtureEvents(), new Set([1]))
    const turn1Index = rows.findIndex(row => row.kind === 'turn' && row.turn === 1)
    const turn2Index = rows.findIndex(row => row.kind === 'turn' && row.turn === 2)
    const turn1Rows = rows.slice(turn1Index + 1, turn2Index)
    expect(turn1Rows).toHaveLength(2)
    expect(turn1Rows[0].kind).toBe('record')
    expect(turn1Rows[1]).toMatchObject({ kind: 'collapsed', turn: 1, count: 2 })
  })
})
