/**
 * Root component: subscribes to the `TuiStore` snapshot and lays out the
 * permanent transcript above a live region (notice, queued indicator, status
 * bar, prompt). Settled session events go into `<Static>` so scrollback stays
 * native — this viewer never redraws history once it's printed.
 * @module @tomowang/dsh-tui/tui/App
 */

import { useMemo, useSyncExternalStore } from 'react'
import { Box, Static, Text, useStdout } from 'ink'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { TuiStore } from './store.js'
import { Banner } from './Banner.js'
import { EventLine } from './EventLine.js'
import { StatusBar } from './StatusBar.js'
import { QueuedIndicator } from './QueuedIndicator.js'
import { PromptInput, type TuiActions } from './PromptInput.js'
import { ModelProfileOverlay } from './modelProfile/ModelProfileOverlay.js'

export type { TuiActions } from './PromptInput.js'

// Ink only tracks one `<Static>` node per app (a single field on its root
// node) — a second sibling `<Static>` silently overwrites the first instead
// of coexisting. The banner therefore has to share the one Static's items
// array with the session events rather than getting its own block.
type StaticItem =
  | { readonly kind: 'banner' }
  | { readonly kind: 'event'; readonly event: SessionEvent; readonly replay: boolean }

export interface AppProps {
  readonly store: TuiStore
  readonly actions: TuiActions
  readonly sessionId: string
  readonly provider: string
  readonly model: string
  readonly version: string
  readonly cwd: string
  readonly columns: number
}

export function App({ store, actions, sessionId, provider, model, version, cwd, columns }: AppProps) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const { stdout } = useStdout()
  const rows = stdout.rows || 24

  // The banner is a fixed item 0; events only ever append after it, so
  // Static's index-based "already printed" bookkeeping stays correct even
  // though this array is rebuilt (with a fresh reference) on every render.
  const items = useMemo<StaticItem[]>(
    () => [
      { kind: 'banner' },
      ...state.events.map(event => ({ kind: 'event' as const, event, replay: event.seq <= state.replayThrough })),
    ],
    [state.events, state.replayThrough],
  )

  return (
    <Box flexDirection="column" height={rows}>
      <Static items={items}>
        {item =>
          item.kind === 'banner' ? (
            <Banner key="banner" version={version} provider={provider} model={model} cwd={cwd} columns={columns} />
          ) : (
            <EventLine key={item.event.seq} event={item.event} replay={item.replay} />
          )
        }
      </Static>
      {/* Static is position:absolute and contributes no height, so this spacer
          is the only thing pushing the live region down to the last row. */}
      <Box flexGrow={1} />
      <Box flexDirection="column">
        {state.overlay.kind === 'modelProfile' ? (
          <ModelProfileOverlay modelProfile={state.overlay.modelProfile} actions={actions} />
        ) : (
          <>
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
          </>
        )}
      </Box>
    </Box>
  )
}
