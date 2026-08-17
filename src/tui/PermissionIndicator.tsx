/**
 * Current permission preset, shown under the prompt input box (mirroring
 * Claude Code's mode line) rather than in the always-present `StatusBar`.
 * @module @tomowang/dsh-tui/tui/PermissionIndicator
 */

import { Text } from 'ink'
import type { PermissionState } from './store.js'
import { theme } from './theme.js'

export interface PermissionIndicatorProps {
  readonly permission: PermissionState | undefined
}

const LABELS: Record<string, string> = {
  'read-only': 'Read Only',
  'workspace-write': 'Workspace Write',
  'danger-full-access': 'Full Access',
  custom: 'Custom',
}

const ICONS: Record<string, string> = {
  'read-only': '⊘',
  'workspace-write': '✎',
  'danger-full-access': '‼',
  custom: '⊛',
}

const COLORS: Record<string, string> = {
  'read-only': theme.info,
  'workspace-write': theme.success,
  'danger-full-access': theme.error,
  custom: theme.muted,
}

function labelFor(preset: string): string {
  return LABELS[preset] ?? preset
}

function iconFor(preset: string): string {
  return ICONS[preset] ?? '•'
}

function colorFor(preset: string): string {
  return COLORS[preset] ?? theme.muted
}

export function PermissionIndicator({ permission }: PermissionIndicatorProps) {
  if (permission === undefined) return null
  return (
    <Text color={theme.muted}>
      <Text color={colorFor(permission.current)}>
        {iconFor(permission.current)} {labelFor(permission.current)}
      </Text>
      {' '}(shift+tab to cycle)
    </Text>
  )
}
