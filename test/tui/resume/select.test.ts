import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import { selectResumeCandidates } from '../../../src/tui/resume/select.js'

const CWD = '/scratch/project/example'
const OTHER_CWD = '/scratch/project/other'
const LIVE_ID = SessionId('session-live')

/** Minimal header fixture; only `version`/`id`/`createdAt` are required by the type. */
function header(overrides: Partial<SessionHeader> & { id: string; createdAt: number }): SessionHeader {
  return { version: 1, cwd: CWD, ...overrides, id: SessionId(overrides.id) }
}

describe('selectResumeCandidates', () => {
  it('keeps a top-level session in the target cwd', () => {
    const h = header({ id: 'session-a', createdAt: 1 })
    expect(selectResumeCandidates([h], CWD, LIVE_ID)).toEqual([h])
  })

  it('excludes a subagent-origin session', () => {
    const h = header({ id: 'session-a', createdAt: 1, origin: 'subagent' })
    expect(selectResumeCandidates([h], CWD, LIVE_ID)).toEqual([])
  })

  it('excludes a session from a different cwd', () => {
    const h = header({ id: 'session-a', createdAt: 1, cwd: OTHER_CWD })
    expect(selectResumeCandidates([h], CWD, LIVE_ID)).toEqual([])
  })

  it('excludes a session with no cwd recorded at all', () => {
    const h: SessionHeader = { version: 1, id: SessionId('session-a'), createdAt: 1 }
    expect(selectResumeCandidates([h], CWD, LIVE_ID)).toEqual([])
  })

  it('excludes the currently live session', () => {
    const h = header({ id: 'session-live', createdAt: 1 })
    expect(selectResumeCandidates([h], CWD, LIVE_ID)).toEqual([])
  })

  it('orders candidates newest first', () => {
    const older = header({ id: 'session-a', createdAt: 100 })
    const newer = header({ id: 'session-b', createdAt: 200 })
    const newest = header({ id: 'session-c', createdAt: 300 })
    expect(selectResumeCandidates([older, newest, newer], CWD, LIVE_ID)).toEqual([newest, newer, older])
  })

  it('applies every filter together, not just the first that matches', () => {
    const wrongCwd = header({ id: 'session-a', createdAt: 1, cwd: OTHER_CWD })
    const subagent = header({ id: 'session-b', createdAt: 2, origin: 'subagent' })
    const live = header({ id: 'session-live', createdAt: 3 })
    const keep = header({ id: 'session-d', createdAt: 4 })
    expect(selectResumeCandidates([wrongCwd, subagent, live, keep], CWD, LIVE_ID)).toEqual([keep])
  })

  it('returns an empty array for an empty input', () => {
    expect(selectResumeCandidates([], CWD, LIVE_ID)).toEqual([])
  })
})
