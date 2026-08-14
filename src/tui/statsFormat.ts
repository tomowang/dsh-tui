/**
 * Pure formatting for the status bar's stats line: turn/step counts, LLM/tool
 * wall time, first-token latency, decode throughput, cache hit rate, and
 * billed tokens. Mirrors the web portal's `StatsLine` (`ui-conversation`)
 * field-for-field so the two surfaces read the same figures the same way;
 * duplicated rather than imported since dsh-tui carries no web-client
 * dependency.
 * @module @tomowang/dsh-tui/tui/statsFormat
 */

import type { SessionStatsProjection } from '@deepseek-ai/dsh-session-stats'
import type { TokenUsageProjection } from '@deepseek-ai/dsh-token-meter'

/**
 * Compact token count: 517 / 12.2K / 517K / 1.2M (one decimal under three digits).
 * @param n - token count.
 * @returns display string.
 */
export function formatTokens(n: number): string {
  const scaled = (v: number): string =>
    v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10)
  if (n < 1_000) return String(n)
  if (n < 1_000_000) return `${scaled(n / 1_000)}K`
  return `${scaled(n / 1_000_000)}M`
}

/**
 * Compact duration: 45.2s under a minute, 2m42s from there on.
 * @param ms - duration in milliseconds.
 * @returns display string.
 */
export function formatDuration(ms: number): string {
  const s = ms / 1_000
  if (s < 60) return `${Math.round(s * 10) / 10}s`
  const whole = Math.round(s)
  return `${Math.floor(whole / 60)}m${whole % 60}s`
}

/**
 * Compact throughput: one decimal under 10 tok/s, whole above.
 * @param tps - tokens per second.
 * @returns display string.
 */
export function formatTokensPerSecond(tps: number): string {
  const clamped = Math.max(0, tps)
  return clamped >= 10 ? String(Math.round(clamped)) : String(Math.round(clamped * 10) / 10)
}

/**
 * Sum the three disjoint prompt-side billing buckets.
 * @param usage - the session's token-usage projection value.
 * @returns billed input tokens.
 */
export function billedInputTokens(usage: TokenUsageProjection): number {
  return usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
}

/**
 * Cache-hit share of prompt-side input over the whole durable log.
 * @param usage - the session's token-usage projection value.
 * @returns rounded integer percent, or null when no input was billed.
 */
export function cacheHitPercent(usage: TokenUsageProjection): number | null {
  const denominator = billedInputTokens(usage)
  return denominator === 0 ? null : Math.round(usage.cacheReadTokens / denominator * 100)
}

/**
 * Build the pipe-separated stats line for the status bar, e.g.
 * `1 turns · 1 steps| LLM 4.3s| TTFT avg 1.1s · 131 tok/s| Cache hit 80%| Input 9.1K tok · Output 412 tok`.
 * A group with no data drops out whole; an empty return means nothing to show yet.
 * @param stats - whole-log turn/step counts and wall times, or `undefined` without the projection unit mounted.
 * @param usage - whole-log provider token usage, or `undefined` without the projection unit mounted.
 * @returns the joined line, or `''` when there is nothing to display.
 */
export function buildStatsLine(
  stats: SessionStatsProjection | undefined,
  usage: TokenUsageProjection | undefined,
): string {
  const groups: string[] = []
  if (stats !== undefined && stats.steps > 0) {
    groups.push(`${stats.turns} turns · ${stats.steps} steps`)
    const durations: string[] = []
    if (stats.llmMs > 0) durations.push(`LLM ${formatDuration(stats.llmMs)}`)
    if (stats.toolMs > 0) durations.push(`Tool call ${formatDuration(stats.toolMs)}`)
    if (durations.length > 0) groups.push(durations.join(' · '))
    const speeds: string[] = []
    if (stats.ttftSteps > 0) speeds.push(`TTFT avg ${formatDuration(stats.ttftMs / stats.ttftSteps)}`)
    if (stats.decodeMs > 0) {
      speeds.push(`${formatTokensPerSecond(stats.decodeTokens / (stats.decodeMs / 1_000))} tok/s`)
    }
    if (speeds.length > 0) groups.push(speeds.join(' · '))
  }
  if (usage !== undefined && (billedInputTokens(usage) > 0 || usage.outputTokens > 0)) {
    const cacheHit = cacheHitPercent(usage)
    if (cacheHit !== null) groups.push(`Cache hit ${cacheHit}%`)
    groups.push(`Input ${formatTokens(billedInputTokens(usage))} tok · Output ${formatTokens(usage.outputTokens)} tok`)
  }
  return groups.join('| ')
}
