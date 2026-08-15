/**
 * `/trajectory` overlay: a turn/step-grouped ledger of the session log (see
 * `layout.ts`) with a keyboard-driven inspector panel, opened the same way
 * `/model` opens `ModelProfileOverlay` — this component owns all of its own
 * navigation/filter/collapse state locally (nothing is store-held; the
 * ledger is re-derived from `state.events` on every render, per the
 * project's log-first-rendering principle).
 *
 * Keys: ↑↓ move selection, Tab/Shift+Tab cycle the detail tab, `c` toggles
 * collapsing the selected record's turn, `/` focuses a substring filter
 * (Esc there defocuses without closing), Esc closes the overlay.
 * @module @tomowang/dsh-tui/tui/trajectory/TrajectoryOverlay
 */

import { useEffect, useMemo, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { TuiActions } from '../PromptInput.js'
import { buildTrajectoryRows } from './layout.js'
import { TrajectoryLedger } from './TrajectoryLedger.js'
import { TrajectoryDetail } from './TrajectoryDetail.js'
import { TRAJECTORY_DETAIL_TABS, type TrajectoryDetailTab, type TrajectoryRow } from './types.js'

export interface TrajectoryOverlayProps {
  readonly events: readonly SessionEvent[]
  readonly availableRows: number
  readonly actions: TuiActions
}

type RecordRow = Extract<TrajectoryRow, { kind: 'record' }>

export function TrajectoryOverlay({ events, availableRows, actions }: TrajectoryOverlayProps) {
  const [collapsedTurns, setCollapsedTurns] = useState<ReadonlySet<number>>(new Set())
  const [filter, setFilter] = useState('')
  const [filterFocused, setFilterFocused] = useState(false)
  const [detailTab, setDetailTab] = useState<TrajectoryDetailTab>('summary')
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)
  const [scrollOffset, setScrollOffset] = useState(0)

  const rows = useMemo(() => buildTrajectoryRows(events, collapsedTurns), [events, collapsedTurns])

  const filteredRows = useMemo(() => {
    const query = filter.trim().toLowerCase()
    if (query === '') return rows
    return rows.filter(
      row => row.kind === 'record' && (row.record.label.toLowerCase().includes(query) || row.record.summary.toLowerCase().includes(query)),
    )
  }, [rows, filter])

  const records = useMemo(
    () => filteredRows.filter((row): row is RecordRow => row.kind === 'record'),
    [filteredRows],
  )

  const selectedIndex = selectedId === undefined ? -1 : records.findIndex(row => row.record.id === selectedId)
  const effectiveIndex = selectedIndex === -1 ? records.length - 1 : selectedIndex
  const selectedRecord = records[effectiveIndex]?.record

  const selectedRowIndex =
    selectedRecord === undefined ? -1 : filteredRows.findIndex(row => row.kind === 'record' && row.record.id === selectedRecord.id)

  const chrome = 2 // header line + footer/filter line
  const remaining = Math.max(6, availableRows - chrome)
  const detailContentHeight = Math.min(6, Math.max(2, Math.floor(remaining / 3)))
  const ledgerHeight = Math.max(3, remaining - detailContentHeight - 1) // -1 for the detail tab bar

  useEffect(() => {
    setScrollOffset(prev => {
      let next = prev
      if (selectedRowIndex < next) next = selectedRowIndex
      else if (selectedRowIndex >= next + ledgerHeight) next = selectedRowIndex - ledgerHeight + 1
      const maxOffset = Math.max(0, filteredRows.length - ledgerHeight)
      return Math.max(0, Math.min(next, maxOffset))
    })
  }, [selectedRowIndex, ledgerHeight, filteredRows.length])

  function moveSelection(delta: number): void {
    if (records.length === 0) return
    const next = Math.min(records.length - 1, Math.max(0, effectiveIndex + delta))
    setSelectedId(records[next].record.id)
  }

  function cycleTab(delta: number): void {
    const index = TRAJECTORY_DETAIL_TABS.indexOf(detailTab)
    const next = (index + delta + TRAJECTORY_DETAIL_TABS.length) % TRAJECTORY_DETAIL_TABS.length
    setDetailTab(TRAJECTORY_DETAIL_TABS[next])
  }

  function toggleCollapse(): void {
    if (selectedRecord === undefined) return
    const { turn } = selectedRecord
    setCollapsedTurns(prev => {
      const next = new Set(prev)
      if (next.has(turn)) next.delete(turn)
      else next.add(turn)
      return next
    })
  }

  useInput((input, key) => {
    if (filterFocused) {
      if (key.escape) setFilterFocused(false)
      return
    }
    if (key.escape) {
      actions.closeTrajectory()
      return
    }
    if (key.upArrow) {
      moveSelection(-1)
      return
    }
    if (key.downArrow) {
      moveSelection(1)
      return
    }
    if (key.tab && key.shift) {
      cycleTab(-1)
      return
    }
    if (key.tab) {
      cycleTab(1)
      return
    }
    if (input === 'c') {
      toggleCollapse()
      return
    }
    if (input === '/') {
      setFilterFocused(true)
    }
  })

  const windowedRows = filteredRows.slice(scrollOffset, scrollOffset + ledgerHeight)

  return (
    <Box flexDirection="column">
      <Text bold>
        Trajectory{filter === '' ? '' : ` — filter: ${filter}`}
        {records.length === 0 ? '' : ` (${effectiveIndex + 1}/${records.length})`}
      </Text>
      <TrajectoryLedger rows={windowedRows} selectedId={selectedRecord?.id} />
      <TrajectoryDetail record={selectedRecord} tab={detailTab} maxLines={detailContentHeight} />
      {filterFocused ? (
        <Box>
          <Text>/ </Text>
          <TextInput value={filter} onChange={setFilter} focus={filterFocused} onSubmit={() => setFilterFocused(false)} />
        </Box>
      ) : (
        <Text dimColor>↑↓ select · tab detail · c collapse · / filter · esc close</Text>
      )}
    </Box>
  )
}
