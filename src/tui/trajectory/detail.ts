/**
 * Per-tab text builders for the `/trajectory` detail pane. Pure functions
 * over a `TrajectoryRecord`, kept separate from rendering so the content
 * logic is unit-testable without Ink.
 * @module @tomowang/dsh-tui/tui/trajectory/detail
 */

import type { TrajectoryDetailTab, TrajectoryRecord } from './types.js'

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString()
}

function summaryText(record: TrajectoryRecord): string {
  const lines = [
    `kind      ${record.kind}`,
    `turn/step ${record.turn}/${record.step}`,
    `started   ${formatTime(record.startedAt)}`,
  ]
  if (record.completedAt !== undefined) {
    lines.push(`duration  ${record.completedAt - record.startedAt}ms`)
  }
  if (record.isError) lines.push('status    error')
  return lines.join('\n')
}

function timingText(record: TrajectoryRecord): string {
  if (record.completedAt === undefined) {
    return `started ${formatTime(record.startedAt)}\n(no completion recorded)`
  }
  return [
    `started   ${formatTime(record.startedAt)}`,
    `completed ${formatTime(record.completedAt)}`,
    `duration  ${record.completedAt - record.startedAt}ms`,
  ].join('\n')
}

/** Render the content of one detail-pane tab for the selected record. */
export function buildDetail(record: TrajectoryRecord, tab: TrajectoryDetailTab): string {
  switch (tab) {
    case 'summary':
      return summaryText(record)
    case 'payload':
      return record.payload ?? '(no payload)'
    case 'result':
      return record.result ?? '—'
    case 'timing':
      return timingText(record)
  }
}
