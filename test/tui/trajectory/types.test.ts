import { describe, expect, it } from 'vitest'
import { detailTabsFor, type TrajectoryRecord } from '../../../src/tui/trajectory/types.js'

/** A minimal `TrajectoryRecord`, overridable per test — every field defaults to its "nothing extra" value. */
function record(overrides: Partial<TrajectoryRecord>): TrajectoryRecord {
  return {
    id: '1',
    kind: 'tool',
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

describe('detailTabsFor', () => {
  it('gives a user record Summary/Preview/Raw/Source when the event carried a source', () => {
    const tabs = detailTabsFor(record({ kind: 'user', source: { kind: 'user' } }))
    expect(tabs).toEqual(['summary', 'preview', 'raw', 'source'])
  })

  it('gives a context record the same shape as user, source included', () => {
    const tabs = detailTabsFor(record({ kind: 'context', source: { kind: 'plugin', plugin: 'skill-loader' } }))
    expect(tabs).toEqual(['summary', 'preview', 'raw', 'source'])
  })

  it('omits Source for a user/context record with no source captured', () => {
    const tabs = detailTabsFor(record({ kind: 'user', source: undefined }))
    expect(tabs).toEqual(['summary', 'preview', 'raw'])
  })

  it('gives an assistant record Summary/Preview/Raw, never Source', () => {
    const tabs = detailTabsFor(record({ kind: 'assistant', payload: 'the answer', source: undefined }))
    expect(tabs).toEqual(['summary', 'preview', 'raw'])
  })

  it('gives a settled tool record Summary/Payload/Result/Schema/Timing', () => {
    const tabs = detailTabsFor(record({ kind: 'tool', payload: '{}', result: 'ok' }))
    expect(tabs).toEqual(['summary', 'payload', 'result', 'schema', 'timing'])
  })

  it('omits Result for a still-pending tool call', () => {
    const tabs = detailTabsFor(record({ kind: 'tool', payload: '{}', result: undefined }))
    expect(tabs).toEqual(['summary', 'payload', 'schema', 'timing'])
  })

  it('omits Payload for an unmatched tool result with no known call', () => {
    const tabs = detailTabsFor(record({ kind: 'tool', payload: undefined, result: 'denied' }))
    expect(tabs).toEqual(['summary', 'result', 'schema', 'timing'])
  })

  it('gives a header record Summary/Payload/Timing, never Schema', () => {
    const tabs = detailTabsFor(record({ kind: 'header', payload: '{}' }))
    expect(tabs).toEqual(['summary', 'payload', 'timing'])
  })
})
