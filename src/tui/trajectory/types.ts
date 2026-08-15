/**
 * Plain data shapes for the `/trajectory` ledger overlay: a turn/step-grouped
 * projection of the session log, independent of Ink/React so `layout.ts` and
 * `detail.ts` stay unit-testable without rendering.
 * @module @tomowang/dsh-tui/tui/trajectory/types
 */

/** What kind of session record a ledger row represents. */
export type TrajectoryRecordKind = 'user' | 'assistant' | 'tool' | 'header'

/** Which tab of the detail pane is showing for the selected record. */
export type TrajectoryDetailTab = 'summary' | 'payload' | 'result' | 'timing'

export const TRAJECTORY_DETAIL_TABS: readonly TrajectoryDetailTab[] = ['summary', 'payload', 'result', 'timing']

/** One selectable ledger entry: a user/assistant message, a tool call+result pair, or a header change. */
export interface TrajectoryRecord {
  /** Stable identity: the tool `callId` for tool records, else `seq` as a string. */
  readonly id: string
  readonly kind: TrajectoryRecordKind
  readonly turn: number
  readonly step: number
  /** The seq of the record's opening event (call/message), used for ordering and selection. */
  readonly seq: number
  readonly startedAt: number
  /** Set once the paired result/message lands; `undefined` for a still-open tool call. */
  readonly completedAt: number | undefined
  /** One-line ledger row text, already truncated/ANSI-decorated like `formatEvent`'s output. */
  readonly label: string
  readonly isError: boolean
  /** Untruncated one-line description for the Summary tab. */
  readonly summary: string
  /** Full input payload (tool arguments, message text, header JSON), for the Payload tab. */
  readonly payload: string | undefined
  /** Full result content (tool result, error), for the Result tab; `undefined` for non-tool kinds. */
  readonly result: string | undefined
}

/** One row of the ledger: a boundary marker, a record, or a collapsed-turn summary. */
export type TrajectoryRow =
  | { readonly kind: 'turn'; readonly turn: number; readonly aborted: string | undefined }
  | { readonly kind: 'step'; readonly turn: number; readonly step: number }
  | { readonly kind: 'record'; readonly record: TrajectoryRecord }
  | { readonly kind: 'collapsed'; readonly turn: number; readonly count: number }
