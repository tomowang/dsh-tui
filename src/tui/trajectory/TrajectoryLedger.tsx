/**
 * Windowed rendering of the `/trajectory` ledger's rows: turn/step boundary
 * markers, one line per record (kind icon + label), and collapsed-turn
 * summaries. `TrajectoryOverlay` owns scroll-window slicing; this component
 * only renders whatever slice it's given.
 * @module @tomowang/dsh-tui/tui/trajectory/TrajectoryLedger
 */

import { Box, Text } from 'ink'
import type { TrajectoryRecord, TrajectoryRow } from './types.js'
import { theme } from '../theme.js'

export interface TrajectoryLedgerProps {
  readonly rows: readonly TrajectoryRow[]
  readonly selectedId: string | undefined
}

function recordGlyph(record: TrajectoryRecord): string {
  if (record.kind === 'tool') return record.isError ? '✖' : '⚙'
  if (record.kind === 'header') return '⊕'
  return ' '
}

function RecordRow({ record, selected }: { record: TrajectoryRecord; selected: boolean }) {
  const color = record.isError ? theme.error : record.kind === 'header' ? theme.muted : undefined
  return (
    <Text inverse={selected} color={color}>
      {selected ? '› ' : '  '}
      {recordGlyph(record)} {record.label}
    </Text>
  )
}

export function TrajectoryLedger({ rows, selectedId }: TrajectoryLedgerProps) {
  return (
    <Box flexDirection="column">
      {rows.map((row, index) => {
        switch (row.kind) {
          case 'turn':
            return (
              <Text key={`turn-${row.turn}`} bold color={theme.secondary}>
                ── Turn {row.turn} ──{row.aborted === undefined ? '' : ` ⚠ ${row.aborted}`}
              </Text>
            )
          case 'step':
            return (
              <Text key={`step-${row.turn}-${row.step}`} color={theme.muted}>
                {'  '}Step {row.step}
              </Text>
            )
          case 'collapsed':
            return (
              <Text key={`collapsed-${row.turn}-${index}`} color={theme.muted}>
                {'  '}… {row.count} record{row.count === 1 ? '' : 's'} collapsed
              </Text>
            )
          case 'record':
            return <RecordRow key={row.record.id} record={row.record} selected={row.record.id === selectedId} />
        }
      })}
    </Box>
  )
}
