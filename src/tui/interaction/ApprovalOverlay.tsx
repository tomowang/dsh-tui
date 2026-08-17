/**
 * In-terminal answerer for one `approval/request` (`@deepseek-ai/dsh-user-approval`):
 * a tool call parked on an `ask` pre-execute decision, waiting for a one-shot
 * allow/reject. Structured like `AgentPresetsOverlay` (cursor + enter), with
 * `y`/`n`/esc shortcuts since this is the highest-frequency interruption.
 * @module @tomowang/dsh-tui/tui/interaction/ApprovalOverlay
 */

import { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import type { TuiActions } from '../PromptInput.js'
import { theme } from '../theme.js'
import type { ApprovalPromptState } from './types.js'

export interface ApprovalOverlayProps {
  readonly approval: ApprovalPromptState
  readonly actions: TuiActions
}

const CHOICES = [
  { outcome: 'allowed-once', label: 'Allow once' },
  { outcome: 'rejected', label: 'Reject' },
] as const

export function ApprovalOverlay({ approval, actions }: ApprovalOverlayProps) {
  const [selected, setSelected] = useState(0)

  useInput((input, key) => {
    if (input === 'y') {
      actions.answerApproval('allowed-once')
      return
    }
    if (input === 'n' || key.escape) {
      actions.answerApproval('rejected')
      return
    }
    if (key.upArrow || key.leftArrow) {
      setSelected(current => (current - 1 + CHOICES.length) % CHOICES.length)
      return
    }
    if (key.downArrow || key.rightArrow) {
      setSelected(current => (current + 1) % CHOICES.length)
      return
    }
    if (key.return) {
      actions.answerApproval(CHOICES[selected].outcome)
    }
  })

  return (
    <Box flexDirection="column">
      <Text bold color={theme.warning}>Approval requested</Text>
      <Text>
        Tool: <Text bold>{approval.toolName}</Text>
        {approval.callId === undefined ? null : <Text color={theme.muted}> ({approval.callId})</Text>}
      </Text>
      {approval.reason === undefined ? null : <Text color={theme.muted}>{approval.reason}</Text>}
      {CHOICES.map((choice, index) => (
        <Text key={choice.outcome} inverse={index === selected} color={choice.outcome === 'rejected' ? theme.error : theme.success}>
          {index === selected ? '› ' : '  '}
          {choice.label}
        </Text>
      ))}
      <Text color={theme.muted}>↑↓ select · enter confirm · y allow · n/esc reject</Text>
    </Box>
  )
}
