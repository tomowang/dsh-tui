import { describe, expect, it } from 'vitest'
import { formatAge } from '../../../src/tui/resume/format.js'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

describe('formatAge', () => {
  it('reads as "just now" for well under a minute', () => {
    expect(formatAge(1_000, 1_000 + 30_000)).toBe('just now')
  })

  it('reads as "just now" at exactly zero elapsed', () => {
    expect(formatAge(1_000, 1_000)).toBe('just now')
  })

  it('never goes negative for a createdAt after now (clock skew)', () => {
    expect(formatAge(2_000, 1_000)).toBe('just now')
  })

  it('reports whole minutes once a full minute has passed', () => {
    expect(formatAge(0, 5 * MINUTE)).toBe('5m ago')
  })

  it('stays in minutes just under an hour', () => {
    expect(formatAge(0, HOUR - 1)).toBe('59m ago')
  })

  it('reports whole hours once a full hour has passed', () => {
    expect(formatAge(0, 3 * HOUR)).toBe('3h ago')
  })

  it('stays in hours just under a day', () => {
    expect(formatAge(0, DAY - 1)).toBe('23h ago')
  })

  it('reads as "yesterday" for one to two days', () => {
    expect(formatAge(0, DAY)).toBe('yesterday')
    expect(formatAge(0, 2 * DAY - 1)).toBe('yesterday')
  })

  it('reports whole days from two days up to a week', () => {
    expect(formatAge(0, 2 * DAY)).toBe('2 days ago')
    expect(formatAge(0, 6 * DAY)).toBe('6 days ago')
  })

  it('falls back to a plain date at a week and beyond', () => {
    const createdAt = Date.UTC(2026, 0, 15) // 2026-01-15
    expect(formatAge(createdAt, createdAt + 7 * DAY)).toBe('2026-01-15')
    expect(formatAge(createdAt, createdAt + 365 * DAY)).toBe('2026-01-15')
  })
})
