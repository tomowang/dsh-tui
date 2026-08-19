/**
 * Pure line-builder for the `/trajectory` overlay's tabbed detail pane:
 * Summary/Payload/Result/Timing, content line-clamped to fit the overlay's
 * height budget.
 * @module @tomowang/dsh-tui/tui/trajectory/TrajectoryDetail
 */

import { buildDetail } from './detail.js'
import { TRAJECTORY_DETAIL_TABS, type TrajectoryDetailTab, type TrajectoryRecord } from './types.js'
import { theme, fg } from '../theme.js'

const muted = fg(theme.muted)

export function buildDetailLines(record: TrajectoryRecord | undefined, tab: TrajectoryDetailTab, maxLines: number): string[] {
  const lines = record === undefined ? [] : buildDetail(record, tab).split('\n')
  const shown = lines.slice(0, maxLines)
  const hidden = lines.length - shown.length

  const tabBar = TRAJECTORY_DETAIL_TABS.map(candidate => (candidate === tab ? `[${candidate}]` : ` ${candidate} `)).join(' ')
  const out: string[] = [tabBar]
  if (record === undefined) {
    out.push(muted('(no record selected)'))
  } else {
    out.push(...shown)
  }
  if (hidden > 0) out.push(muted(`… ${hidden} more line${hidden === 1 ? '' : 's'}`))
  return out
}
