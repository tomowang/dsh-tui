/**
 * `/plugins` overlay: a scrollable, read-only list of every entry in the
 * loader's tree, snapshotted once at open time (see `pluginRows()` in
 * `index.ts`) rather than kept live — the tree rarely changes mid-session,
 * and re-snapshotting on every render would fight the scroll position.
 * Structured like `ContextOverlay` (no selection/detail state), borrowing
 * only `TrajectoryOverlay`'s scroll-offset math since 80+ entries won't fit
 * one screen.
 * @module @tomowang/dsh-tui/tui/plugins/PluginsOverlay
 */

import { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import type { TuiActions } from '../PromptInput.js'
import type { PluginRow } from './types.js'
import { theme } from '../theme.js'

export interface PluginsOverlayProps {
  readonly rows: readonly PluginRow[]
  readonly availableRows: number
  readonly actions: TuiActions
}

const STATE_LABEL: Record<NonNullable<PluginRow['state']>, string> = {
  pending: 'pending',
  loading: 'loading',
  active: 'active',
  failed: 'failed',
  disposed: 'disposed',
  unloading: 'unloading',
}

function rowLabel(row: PluginRow): string {
  if (row.state !== undefined) return STATE_LABEL[row.state]
  return row.disabled ? 'off' : '···'
}

export function PluginsOverlay({ rows, availableRows, actions }: PluginsOverlayProps) {
  const [scrollOffset, setScrollOffset] = useState(0)

  const chrome = 2 // header line + footer line
  const listHeight = Math.max(3, availableRows - chrome)
  const maxOffset = Math.max(0, rows.length - listHeight)
  const offset = Math.min(scrollOffset, maxOffset)

  useInput((input, key) => {
    if (key.escape || input === 'q') {
      actions.closePlugins()
      return
    }
    if (key.upArrow) {
      setScrollOffset(prev => Math.max(0, prev - 1))
      return
    }
    if (key.downArrow) {
      setScrollOffset(prev => Math.min(maxOffset, prev + 1))
      return
    }
    if (key.pageUp) {
      setScrollOffset(prev => Math.max(0, prev - listHeight))
      return
    }
    if (key.pageDown) {
      setScrollOffset(prev => Math.min(maxOffset, prev + listHeight))
    }
  })

  const windowedRows = rows.slice(offset, offset + listHeight)
  const activeCount = rows.filter(row => row.state === 'active').length
  const failedCount = rows.filter(row => row.state === 'failed').length

  return (
    <Box flexDirection="column">
      <Text bold color={theme.secondary}>
        Plugins ({rows.length}) — {activeCount} active{failedCount === 0 ? '' : `, ${failedCount} failed`}
      </Text>
      {windowedRows.map(row => (
        <Box key={row.id}>
          <Text
            color={row.disabled ? theme.muted : row.state === 'failed' ? theme.error : row.state === 'active' ? theme.success : undefined}
          >
            {rowLabel(row).padEnd(8)}
          </Text>
          <Text color={row.disabled ? theme.muted : undefined}> {row.id}</Text>
          <Text color={theme.muted}> ({row.name})</Text>
        </Box>
      ))}
      <Text color={theme.muted}>↑↓ scroll · esc close</Text>
    </Box>
  )
}
