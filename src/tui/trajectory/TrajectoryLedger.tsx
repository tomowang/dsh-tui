/**
 * Windowed rendering of the `/trajectory` ledger's rows: turn/step boundary
 * markers, one line per record (colored kind tag + icon + label), and
 * collapsed-turn summaries. `TrajectoryOverlay` owns scroll-window slicing;
 * this component only renders whatever slice it's given.
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

/** Kind tags, matching the web ledger's USER/CONTEXT/ASSISTANT/TOOL wording exactly (`header` has no web counterpart). */
const KIND_TAG: Record<TrajectoryRecord['kind'], string> = {
  user: 'USER',
  context: 'CONTEXT',
  assistant: 'ASSISTANT',
  tool: 'TOOL',
  header: 'HEADER',
}

const KIND_TAG_WIDTH = Math.max(...Object.values(KIND_TAG).map(tag => tag.length))

/** Mirrors the web ledger's per-row kind tag coloring (assistant violet, tool amber, user brand blue, context mint, header neutral). */
function kindColor(kind: TrajectoryRecord['kind']): string {
  switch (kind) {
    case 'user': return theme.primary
    case 'context': return theme.success
    case 'assistant': return theme.reasoning
    case 'tool': return theme.warning
    case 'header': return theme.muted
  }
}

function RecordRow({ record, selected }: { record: TrajectoryRecord; selected: boolean }) {
  const color = record.isError ? theme.error : record.kind === 'header' ? theme.muted : undefined
  return (
    <Text inverse={selected} color={color}>
      {selected ? '› ' : '  '}
      <Text color={kindColor(record.kind)} bold>{KIND_TAG[record.kind].padEnd(KIND_TAG_WIDTH)}</Text>
      {' '}
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
