/**
 * Plain, Cordis-agnostic snapshot of one subagent, joined from
 * `ctx.subagents.listChildren()` for the `/agents` overlay. Mirrors the
 * harness's own `SubagentListEntry` discriminated union directly rather than
 * flattening it, so a `child` row's `mode`/`activity` stay non-optional.
 * @module @tomowang/dsh-tui/tui/agents/types
 */

/** One direct subagent child whose creation descriptor `listChildren` could interpret. */
export interface SubagentChildRow {
  readonly kind: 'child'
  /** Durable child session id, stable across Activations. */
  readonly id: string
  /** Display label: the child's own creation label, else its session id. */
  readonly label: string
  /** `'one-shot'` (terminal, `subagent_fork`) or `'continuable'` (resumable, `subagent`). */
  readonly mode: 'one-shot' | 'continuable'
  /** `'running'` means the child is live in `ctx.sessions`; `'inactive'` means it exists only in persistence. */
  readonly activity: 'running' | 'inactive'
  /** Whether a direct descendant of this child is itself a subagent. */
  readonly hasChildren: boolean
}

/** A candidate `listChildren` could not interpret (a damaged or unreadable creation descriptor) — still a row, so its existence isn't silently dropped from the count. */
export interface SubagentDiagnosticRow {
  readonly kind: 'diagnostic'
  readonly id: string
  readonly diagnostic: 'corrupt' | 'unsupported' | 'unavailable'
}

export type SubagentRow = SubagentChildRow | SubagentDiagnosticRow
