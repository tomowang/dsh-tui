/**
 * Preview of messages waiting in the agent's inbox — steering or follow-up
 * input the driver has not claimed into a step yet.
 * @module @tomowang/dsh-tui/tui/QueuedIndicator
 */

import { Box, Text } from 'ink'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { truncate } from '../render.js'
import { theme } from './theme.js'

export interface QueuedIndicatorProps {
  readonly queued: readonly UserMessage[]
}

function previewOf(message: UserMessage): string {
  const text = message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
  return truncate(text, 80)
}

export function QueuedIndicator({ queued }: QueuedIndicatorProps) {
  if (queued.length === 0) return null
  return (
    <Box flexDirection="column">
      {queued.map(message => (
        <Text key={message.id} color={theme.muted}>
          ↳ queued: {previewOf(message)}
        </Text>
      ))}
    </Box>
  )
}
