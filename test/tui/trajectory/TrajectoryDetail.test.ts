import { describe, expect, it } from 'vitest'
import { buildDetailLines } from '../../../src/tui/trajectory/TrajectoryDetail.js'
import type { TrajectoryRecord } from '../../../src/tui/trajectory/types.js'

/** A minimal `TrajectoryRecord`, overridable per test — every field defaults to its "nothing extra" value. */
function record(overrides: Partial<TrajectoryRecord>): TrajectoryRecord {
  return {
    id: '1',
    kind: 'assistant',
    turn: 1,
    step: 1,
    seq: 1,
    startedAt: 0,
    completedAt: undefined,
    label: 'label',
    isError: false,
    summary: 'summary',
    payload: undefined,
    result: undefined,
    reasoning: undefined,
    source: undefined,
    toolName: undefined,
    ...overrides,
  }
}

describe('buildDetailLines', () => {
  it('word-wraps a long paragraph to the pane width instead of leaving it on one line', () => {
    const payload = 'one two three four five six seven eight nine ten'
    const lines = buildDetailLines(record({ payload }), 'preview', 20, undefined, 12)
    // Drop the tab-bar header line; every remaining body line must fit the width.
    const body = lines.slice(1)
    expect(body.length).toBeGreaterThan(1)
    for (const line of body) expect(line.length).toBeLessThanOrEqual(12)
    // Reassembling the wrapped, indented lines should still read as the original words in order.
    expect(body.join(' ').trim().replace(/\s+/g, ' ')).toBe(payload)
  })

  it('leaves a 2-column right margin, matching the left indent, by wrapping short of the pane width', () => {
    // A single long word can't be broken short of the width, so use words
    // that force a wrap well before the edge if the margin is honored.
    const payload = 'aaaa bbbb cccc dddd'
    const lines = buildDetailLines(record({ payload }), 'preview', 20, undefined, 10)
    const body = lines.slice(1)
    // 2-space left indent + wrapped content must never reach the last 2 columns (width 10).
    for (const line of body) expect(line.length).toBeLessThanOrEqual(8)
  })

  it('shows the no-record placeholder without attempting to wrap anything', () => {
    const lines = buildDetailLines(undefined, 'summary', 20, undefined, 40)
    expect(lines.some(line => line.includes('no record selected'))).toBe(true)
  })

  it('counts hidden lines against the wrapped total, not the raw paragraph count', () => {
    const payload = 'one two three four five six seven eight nine ten'
    const lines = buildDetailLines(record({ payload }), 'preview', 1, undefined, 12)
    expect(lines.some(line => line.includes('more line'))).toBe(true)
  })
})
