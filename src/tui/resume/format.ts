/**
 * Pure display formatting for the `/resume` picker — split out from
 * `ResumeOverlay` so the calendar-relative-age math is testable without a
 * `TUI` instance, mirroring `trajectory/TrajectoryDetail.ts`'s split from
 * `TrajectoryOverlay`.
 * @module @tomowang/dsh-tui/tui/resume/format
 */

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/**
 * Calendar-relative age for the picker's trailing column: "2h ago",
 * "yesterday", "3 days ago", then a plain `YYYY-MM-DD` date past a week.
 * @param createdAt - session creation time, Unix epoch milliseconds.
 * @param now - reference time, Unix epoch milliseconds (injected rather than
 *   read internally, so this stays pure and testable).
 */
export function formatAge(createdAt: number, now: number): string {
  const diff = Math.max(0, now - createdAt)
  if (diff < MINUTE_MS) return 'just now'
  if (diff < HOUR_MS) return `${Math.floor(diff / MINUTE_MS)}m ago`
  if (diff < DAY_MS) return `${Math.floor(diff / HOUR_MS)}h ago`
  if (diff < 2 * DAY_MS) return 'yesterday'
  if (diff < 7 * DAY_MS) return `${Math.floor(diff / DAY_MS)} days ago`
  return new Date(createdAt).toISOString().slice(0, 10)
}
