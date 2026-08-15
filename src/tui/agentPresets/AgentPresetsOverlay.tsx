/**
 * `/presets` overlay: the deployment's agent-preset roster, with the
 * session's current preset marked. Selection and apply follow
 * `ProviderList`'s pattern (cursor lives in the store, Enter acts on it)
 * rather than `PluginsOverlay`'s read-only scroll — this list is short but
 * actionable. A switch is only accepted while the session is blank (no turn
 * has run yet); the host enforces that too, so this is a UX guard, not the
 * only guard.
 * @module @tomowang/dsh-tui/tui/agentPresets/AgentPresetsOverlay
 */

import { Box, Text, useInput } from 'ink'
import type { TuiActions } from '../PromptInput.js'
import type { AgentPresetsOverlayState } from '../store.js'

export interface AgentPresetsOverlayProps {
  readonly agentPresets: AgentPresetsOverlayState
  readonly actions: TuiActions
}

export function AgentPresetsOverlay({ agentPresets, actions }: AgentPresetsOverlayProps) {
  const { rows, selected, current, blank, busy, error } = agentPresets

  useInput((input, key) => {
    if (key.escape || input === 'q') {
      actions.closeAgentPresets()
      return
    }
    if (rows.length === 0) return
    if (key.upArrow) {
      actions.selectAgentPresetRow(Math.max(0, selected - 1))
      return
    }
    if (key.downArrow) {
      actions.selectAgentPresetRow(Math.min(rows.length - 1, selected + 1))
      return
    }
    if (key.return && blank) {
      const row = rows[selected]
      if (row.broken === undefined) actions.applyAgentPreset(row.id)
    }
  })

  return (
    <Box flexDirection="column">
      <Text bold>Agent presets</Text>
      {error === undefined ? null : <Text color="red">{error}</Text>}
      {busy && rows.length === 0 ? <Text dimColor>Loading…</Text> : null}
      {rows.map((row, index) => (
        <Box key={row.id} flexDirection="column">
          <Text inverse={index === selected}>
            {index === selected ? '› ' : '  '}
            {row.id === current ? '● ' : '○ '}
            {row.label}
            {row.trust === 'user' ? ' (custom)' : ''}
          </Text>
          {row.broken !== undefined ? (
            <Text color="red">    broken: {row.broken}</Text>
          ) : row.description !== undefined ? (
            <Text dimColor>    {row.description}</Text>
          ) : null}
        </Box>
      ))}
      {rows.length === 0 && !busy ? <Text dimColor>No agent presets configured in this profile.</Text> : null}
      <Text dimColor>{blank ? '↑↓ select · enter apply · esc close' : 'session already started — preset is fixed · esc close'}</Text>
    </Box>
  )
}
