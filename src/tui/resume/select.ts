/**
 * Pure candidate selection for the `/resume` picker — split out from
 * `loadResumeSessions` (`index.ts`) so the filtering/ordering rule is
 * testable against plain `SessionHeader[]` fixtures, without a live
 * `ctx.sessionPersistence` to fetch from.
 * @module @tomowang/dsh-tui/tui/resume/select
 */

import type { SessionHeader, SessionId } from '@deepseek-ai/dsh-session'

/**
 * This cwd's own top-level sessions, newest first: excludes subagent
 * children (those belong to `/agents`, not here) and the currently live
 * session (resuming into itself has no meaning).
 * @param headers - every persisted session's header, from `sessionPersistence.list()`.
 * @param cwd - `process.cwd()` — the picker only offers sessions started here.
 * @param liveSessionId - the current session's id, excluded from its own picker.
 */
export function selectResumeCandidates(
  headers: readonly SessionHeader[],
  cwd: string,
  liveSessionId: SessionId,
): SessionHeader[] {
  return headers
    .filter(header => header.origin !== 'subagent' && header.cwd === cwd && header.id !== liveSessionId)
    .sort((a, b) => b.createdAt - a.createdAt)
}
