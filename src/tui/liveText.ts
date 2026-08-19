/**
 * Pure text builders for the small always-present live-region rows (status
 * bar, queued-message preview, permission indicator) — the pi-tui
 * equivalents of the old `StatusBar.tsx`/`QueuedIndicator.tsx`/
 * `PermissionIndicator.tsx`, minus the Ink wrapper. `TuiApp` renders each of
 * these through a `DynamicText` that calls the builder fresh every frame, so
 * they always reflect the latest store snapshot (and, for the status bar,
 * the spinner's current frame) without any manual `setText` bookkeeping.
 * @module @tomowang/dsh-tui/tui/liveText
 */

import type { AgentStatus } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { truncate } from '../render.js'
import { stripSessionIdPrefix } from '../sessionId.js'
import type { PermissionState } from './store.js'
import { theme, fg } from './theme.js'

const dim = fg(theme.muted)
const accent = fg(theme.accent)

export interface StatusBarParams {
  readonly sessionId: string
  readonly provider: string
  readonly model: string
  readonly status: AgentStatus
  readonly queuedCount: number
  /** Current agent preset's display label, or `undefined` without a mounted preset service. */
  readonly presetLabel: string | undefined
  /** Number of events logged to `agent.session.events` so far. */
  readonly eventCount: number
  /** Current animation frame, shown only while `status === 'running'`. */
  readonly spinnerChar: string
}

export function buildStatusBarText(params: StatusBarParams): string {
  const { sessionId, provider, model, status, queuedCount, presetLabel, eventCount, spinnerChar } = params
  const queuedSuffix = queuedCount > 0 ? ` · ${queuedCount} queued` : ''
  const presetSegment = presetLabel === undefined ? '' : ` · ${presetLabel}`
  const spinnerPart = status === 'running' ? spinnerChar : ''
  return (
    dim(`session ${stripSessionIdPrefix(sessionId)} · `) +
    accent(`${provider}/${model}`) +
    dim(`${presetSegment} · ${spinnerPart} ${status}${queuedSuffix} · ${eventCount} events`)
  )
}

function previewOf(message: UserMessage): string {
  const text = message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
  return truncate(text, 80)
}

export function buildQueuedText(queued: readonly UserMessage[]): string {
  if (queued.length === 0) return ''
  return queued.map(message => dim(`↳ queued: ${previewOf(message)}`)).join('\n')
}

const PERMISSION_LABELS: Record<string, string> = {
  'read-only': 'Read Only',
  'workspace-write': 'Workspace Write',
  'danger-full-access': 'Full Access',
  custom: 'Custom',
}

const PERMISSION_ICONS: Record<string, string> = {
  'read-only': '⊘',
  'workspace-write': '✎',
  'danger-full-access': '‼',
  custom: '⊛',
}

const PERMISSION_COLORS: Record<string, string> = {
  'read-only': theme.info,
  'workspace-write': theme.success,
  'danger-full-access': theme.error,
  custom: theme.muted,
}

export function buildPermissionText(permission: PermissionState | undefined): string {
  if (permission === undefined) return ''
  const icon = PERMISSION_ICONS[permission.current] ?? '•'
  const label = PERMISSION_LABELS[permission.current] ?? permission.current
  const color = fg(PERMISSION_COLORS[permission.current] ?? theme.muted)
  return `${color(`${icon} ${label}`)}${dim(' (shift+tab to cycle)')}`
}
