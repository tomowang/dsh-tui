/**
 * Tabbed detail pane for the `/trajectory` overlay's selected record:
 * Summary/Payload/Result/Timing, content line-clamped to fit the overlay's
 * height budget.
 * @module @tomowang/dsh-tui/tui/trajectory/TrajectoryDetail
 */

import { Box, Text } from 'ink'
import { buildDetail } from './detail.js'
import { TRAJECTORY_DETAIL_TABS, type TrajectoryDetailTab, type TrajectoryRecord } from './types.js'

export interface TrajectoryDetailProps {
  readonly record: TrajectoryRecord | undefined
  readonly tab: TrajectoryDetailTab
  readonly maxLines: number
}

export function TrajectoryDetail({ record, tab, maxLines }: TrajectoryDetailProps) {
  const lines = record === undefined ? [] : buildDetail(record, tab).split('\n')
  const shown = lines.slice(0, maxLines)
  const hidden = lines.length - shown.length

  return (
    <Box flexDirection="column">
      <Text>
        {TRAJECTORY_DETAIL_TABS.map(candidate => (candidate === tab ? `[${candidate}]` : ` ${candidate} `)).join(' ')}
      </Text>
      {record === undefined ? (
        <Text dimColor>(no record selected)</Text>
      ) : (
        shown.map((line, index) => <Text key={index}>{line}</Text>)
      )}
      {hidden > 0 ? <Text dimColor>… {hidden} more line{hidden === 1 ? '' : 's'}</Text> : null}
    </Box>
  )
}
