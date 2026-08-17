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

  it('collapses a plugin-injected user/message to a label with no payload', () => {
    const rows = buildTrajectoryRows(
      [
        event('turn/start', 1, { turn: 1 }),
        event('user/message', 2, {
          source: { kind: 'plugin', plugin: 'skill-loader', form: 'notice', summary: 'loaded foo skill' },
          content: [{ type: 'text', text: 'full skill body that should never surface in the ledger' }],
        }),
      ],
      new Set(),
    )
    const record = recordRows(rows)[0]?.record
    expect(record?.label).toBe('context › skill-loader · loaded foo skill')
    expect(record?.payload).toBeUndefined()
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
