/**
 * Plain, Cordis-agnostic snapshot of one resumable session, joined from
 * `ctx.sessionPersistence.list()` (+ a per-session title fold) for the
 * `/resume` picker.
 * @module @tomowang/dsh-tui/tui/resume/types
 */

/** One past session in the current working directory, offered by the `/resume` picker. */
export interface SessionResumeRow {
  /** Durable session id, with the `session-` prefix already stripped for display and reuse as a `/resume <id>` argument. */
  readonly id: string
  /** Latest accepted title, or `undefined` when the session never got one (no reply landed, or it was cleared before one accrued). */
  readonly title: string | undefined
  /** Non-negative safe-integer Unix epoch milliseconds the session was created. */
  readonly createdAt: number
}
