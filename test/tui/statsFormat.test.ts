import { describe, expect, it } from 'vitest'
import type { SessionStatsProjection } from '@deepseek-ai/dsh-session-stats'
import type { TokenUsageProjection } from '@deepseek-ai/dsh-token-meter'
import {
  billedInputTokens,
  buildStatsLine,
  cacheHitPercent,
  formatDuration,
  formatTokens,
  formatTokensPerSecond,
} from '../../src/tui/statsFormat.js'

describe('formatTokens', () => {
  it('renders raw integers under 1000', () => {
    expect(formatTokens(0)).toBe('0')
    expect(formatTokens(999)).toBe('999')
  })

  it('uses a K suffix with one decimal under 100K-scaled', () => {
    expect(formatTokens(1000)).toBe('1K')
    expect(formatTokens(12345)).toBe('12.3K')
  })

  it('rounds to a whole number at or above 100K-scaled', () => {
    expect(formatTokens(123456)).toBe('123K')
    expect(formatTokens(999999)).toBe('1000K')
  })

  it('uses an M suffix past a million', () => {
    expect(formatTokens(1000000)).toBe('1M')
    expect(formatTokens(2500000)).toBe('2.5M')
  })
})

describe('formatDuration', () => {
  it('renders sub-minute durations with one decimal of seconds', () => {
    expect(formatDuration(4520)).toBe('4.5s')
  })

  it('lands in the minutes branch at the 60s boundary', () => {
    expect(formatDuration(60000)).toBe('1m0s')
  })

  it('renders minutes and seconds above a minute', () => {
    expect(formatDuration(162000)).toBe('2m42s')
  })
})

describe('formatTokensPerSecond', () => {
  it('clamps negative input to 0', () => {
    expect(formatTokensPerSecond(-5)).toBe('0')
  })

  it('renders one decimal under 10', () => {
    expect(formatTokensPerSecond(4.26)).toBe('4.3')
  })

  it('rounds to a whole number at or above 10', () => {
    expect(formatTokensPerSecond(131.4)).toBe('131')
  })
})

function usage(partial: Partial<TokenUsageProjection>): TokenUsageProjection {
  return {
    uncachedInputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    ...partial,
  } as TokenUsageProjection
}

describe('billedInputTokens', () => {
  it('sums the three input-token buckets', () => {
    expect(billedInputTokens(usage({ uncachedInputTokens: 1, cacheReadTokens: 2, cacheWriteTokens: 3 }))).toBe(6)
  })
})

describe('cacheHitPercent', () => {
  it('is null when no input was billed', () => {
    expect(cacheHitPercent(usage({}))).toBeNull()
  })

  it('is the rounded cache-read share of billed input', () => {
    expect(cacheHitPercent(usage({ uncachedInputTokens: 20, cacheReadTokens: 80 }))).toBe(80)
  })
})

function stats(partial: Partial<SessionStatsProjection>): SessionStatsProjection {
  return {
    turns: 0,
    steps: 0,
    llmMs: 0,
    toolMs: 0,
    ttftMs: 0,
    ttftSteps: 0,
    decodeMs: 0,
    decodeTokens: 0,
    ...partial,
  } as SessionStatsProjection
}

describe('buildStatsLine', () => {
  it('renders nothing when both sides are undefined', () => {
    expect(buildStatsLine(undefined, undefined)).toBe('')
  })

  it('drops the whole stats group when steps is 0', () => {
    expect(buildStatsLine(stats({ steps: 0, turns: 1 }), undefined)).toBe('')
  })

  it('shows only turns/steps when every sub-figure is zero', () => {
    expect(buildStatsLine(stats({ turns: 1, steps: 2 }), undefined)).toBe('1 turns · 2 steps')
  })

  it('joins llm and tool durations', () => {
    const line = buildStatsLine(stats({ turns: 1, steps: 1, llmMs: 4300, toolMs: 1200 }), undefined)
    expect(line).toContain('LLM 4.3s')
    expect(line).toContain('Tool call 1.2s')
    expect(line).toContain('LLM 4.3s · Tool call 1.2s')
  })

  it('drops the usage group when nothing was billed or produced', () => {
    expect(buildStatsLine(undefined, usage({}))).toBe('')
  })

  it('omits Cache hit but keeps token counts when nothing was billed as input', () => {
    const line = buildStatsLine(undefined, usage({ outputTokens: 412 }))
    expect(line).not.toContain('Cache hit')
    expect(line).toContain('Input 0 tok · Output 412 tok')
  })

  it('joins multiple groups with a pipe', () => {
    const line = buildStatsLine(
      stats({ turns: 1, steps: 1, llmMs: 4300 }),
      usage({ uncachedInputTokens: 2000, cacheReadTokens: 8000, outputTokens: 412 }),
    )
    expect(line).toContain('1 turns · 1 steps')
    expect(line).toContain('LLM 4.3s')
    expect(line).toContain('Cache hit 80%')
    expect(line).toContain('Input 10K tok · Output 412 tok')
    expect(line.split('| ').length).toBeGreaterThan(1)
  })
})
