/**
 * Root component: subscribes to the `TuiStore` snapshot and lays out the
 * permanent transcript above a live region (notice, queued indicator, status
 * bar, prompt). Settled session events go into `<Static>` so scrollback stays
 * native — this viewer never redraws history once it's printed.
 * @module @tomowang/dsh-tui/tui/App
 */

import { useSyncExternalStore } from 'react'
import { Box, Static, Text } from 'ink'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { TuiStore } from './store.js'
import { EventLine } from './EventLine.js'
import { StatusBar } from './StatusBar.js'
import { QueuedIndicator } from './QueuedIndicator.js'
import { PromptInput, type TuiActions } from './PromptInput.js'

export type { TuiActions } from './PromptInput.js'

export interface AppProps {
  readonly store: TuiStore
  readonly actions: TuiActions
  readonly sessionId: string
  readonly provider: string
  readonly model: string
}

export function App({ store, actions, sessionId, provider, model }: AppProps) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)

  return (
    <Box flexDirection="column">
      {/* Static requires a mutable array type; it never mutates what it's given. */}
      <Static items={state.events as SessionEvent[]}>
        {event => <EventLine key={event.seq} event={event} replay={event.seq <= state.replayThrough} />}
      </Static>
      <Box flexDirection="column">
        {state.notice === undefined ? null : <Text>{state.notice}</Text>}
        <QueuedIndicator queued={state.queued} />
        <StatusBar
          sessionId={sessionId}
          provider={provider}
          model={model}
          status={state.status}
          queuedCount={state.queued.length}
        />
        <PromptInput status={state.status} actions={actions} />
      </Box>
    </Box>
  )
}
