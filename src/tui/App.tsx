/**
 * Root component: subscribes to the `TuiStore` snapshot and lays out the
 * permanent transcript above a live region (notice, queued indicator, status
 * bar, prompt). Settled session events go into `<Static>` so scrollback stays
 * native — this viewer never redraws history once it's printed.
 * @module @tomowang/dsh-tui/tui/App
 */

import { useMemo, useState, useSyncExternalStore } from 'react'
import { Box, Static, Text, useStdout, useWindowSize } from 'ink'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { TuiStore } from './store.js'
import { Banner } from './Banner.js'
import { EventLine } from './EventLine.js'
import { StatusBar } from './StatusBar.js'
import { QueuedIndicator } from './QueuedIndicator.js'
import { PermissionIndicator } from './PermissionIndicator.js'
import { PromptInput, type TuiActions } from './PromptInput.js'
import { ModelProfileOverlay } from './modelProfile/ModelProfileOverlay.js'
import { buildBannerText } from './bannerText.js'
import { formatEvent } from '../render.js'

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
  /** Submitted-line history for the prompt's up/down-arrow recall; owned outside the Ink tree so `/clear` can preserve it. */
  readonly promptHistory: string[]
}

function countEventLines(event: SessionEvent, replay: boolean): number {
  const formatted = formatEvent(event, { replay })
  if (formatted === undefined || formatted === '') return 0
  return formatted.split('\n').length
}

export function App({ store, actions, sessionId, provider, model, version, cwd, columns: initialColumns, promptHistory }: AppProps) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const { stdout } = useStdout()
  const { rows: windowRows, columns: windowColumns } = useWindowSize()
  const rows = windowRows || stdout.rows || 24
  const columns = windowColumns || initialColumns || stdout.columns || 80
  const [commandMatchesCount, setCommandMatchesCount] = useState(0)
  const [promptLineCount, setPromptLineCount] = useState(1)

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

  const staticLines = useMemo(() => {
    const bannerLines = buildBannerText({ version, provider, model, cwd }, columns).split('\n').length
    const eventLines = state.events.reduce((total, event) => {
      return total + countEventLines(event, event.seq <= state.replayThrough)
    }, 0)
    return bannerLines + eventLines
  }, [version, provider, model, cwd, columns, state.events, state.replayThrough])

  const dynamicLines = useMemo(() => {
    if (state.overlay.kind === 'modelProfile') {
      const mp = state.overlay.modelProfile
      if (mp.view === 'form') {
        const errorLine = mp.error !== undefined ? 1 : 0
        const isNewLine = mp.draft?.isNew ? 1 : 0
        return 8 + errorLine + isNewLine
      }
      const errorLine = mp.error !== undefined ? 1 : 0
      const loadingLine = mp.busy && mp.providers === undefined ? 1 : 0
      const listRows = mp.providers?.length ?? 1
      return 2 + errorLine + loadingLine + listRows
    }
    const noticeLines = state.notice === undefined ? 0 : state.notice.split('\n').length
    const queuedLines = state.queued.length
    const statusBarLines = 1
    // 2 accounts for the prompt box's top/bottom border; promptLineCount is
    // its content rows, which grow with a multi-line draft.
    const promptLines = 2 + promptLineCount + commandMatchesCount
    const permissionLines = state.permission === undefined ? 0 : 1
    return noticeLines + queuedLines + statusBarLines + promptLines + permissionLines
  }, [state.overlay, state.notice, state.queued.length, commandMatchesCount, promptLineCount, state.permission])

  // Ink appends a trailing newline to interactive frames (output + '\n'),
  // so we subtract 1 to ensure total rendered lines don't exceed terminal rows.
  const spacerHeight = Math.max(0, rows - staticLines - dynamicLines - 1)

  return (
    <Box flexDirection="column">
      <Static items={items}>
        {item =>
          item.kind === 'banner' ? (
            <Banner key="banner" version={version} provider={provider} model={model} cwd={cwd} columns={columns} />
          ) : (
            <EventLine key={item.event.seq} event={item.event} replay={item.replay} />
          )
        }
      </Static>
      <Box flexDirection="column">
        {spacerHeight > 0 && <Box height={spacerHeight} />}
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
            <PromptInput
              status={state.status}
              actions={actions}
              onCommandMatchesChange={setCommandMatchesCount}
              onLinesChange={setPromptLineCount}
              history={promptHistory}
            />
            <PermissionIndicator permission={state.permission} />
          </>
        )}
      </Box>
    </Box>
  )
}
