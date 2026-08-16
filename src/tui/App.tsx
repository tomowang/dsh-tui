/**
 * Root component: subscribes to the `TuiStore` snapshot and lays out the
 * permanent transcript above a live region (notice, queued indicator, status
 * bar, prompt). Settled session events go into `<Static>` so scrollback stays
 * native — this viewer never redraws history once it's printed.
 * @module @tomowang/dsh-tui/tui/App
 */

import { useMemo, useReducer, useSyncExternalStore } from 'react'
import { Box, Static, Text, useStdout, useWindowSize } from 'ink'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { TuiStore } from './store.js'
import { Banner } from './Banner.js'
import { EventLine } from './EventLine.js'
import { StreamingLine } from './StreamingLine.js'
import { StatusBar } from './StatusBar.js'
import { StatsLine } from './StatsLine.js'
import { QueuedIndicator } from './QueuedIndicator.js'
import { PermissionIndicator } from './PermissionIndicator.js'
import { PromptInput, bufferReducer, initialState, type TuiActions } from './PromptInput.js'
import { ModelProfileOverlay } from './modelProfile/ModelProfileOverlay.js'
import { TrajectoryOverlay } from './trajectory/TrajectoryOverlay.js'
import { ContextOverlay } from './context/ContextOverlay.js'
import { PluginsOverlay } from './plugins/PluginsOverlay.js'
import { AgentPresetsOverlay } from './agentPresets/AgentPresetsOverlay.js'
import { ApprovalOverlay } from './interaction/ApprovalOverlay.js'
import { QuestionOverlay } from './interaction/QuestionOverlay.js'
import { buildBannerText } from './bannerText.js'
import { buildStatsLine, buildContextLine } from './statsFormat.js'
import { commandQuery } from './commands.js'
import { formatEvent, formatStreamingText, type RenderOptions } from '../render.js'

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
  /** Look up a tool's declared presentation, for `tool/call`/`tool/result` cards. */
  readonly getTool: RenderOptions['getTool']
  /** Look up a `tool/call`'s name/arguments by `callId`, for a `tool/result` to present with. */
  readonly getToolCall: RenderOptions['getToolCall']
}

function countEventLines(event: SessionEvent, replay: boolean, getTool: RenderOptions['getTool'], getToolCall: RenderOptions['getToolCall']): number {
  const formatted = formatEvent(event, { replay, getTool, getToolCall })
  if (formatted === undefined || formatted === '') return 0
  return formatted.split('\n').length
}

export function App({
  store,
  actions,
  sessionId,
  provider,
  model,
  version,
  cwd,
  columns: initialColumns,
  promptHistory,
  getTool,
  getToolCall,
}: AppProps) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const { stdout } = useStdout()
  const { rows: windowRows, columns: windowColumns } = useWindowSize()
  const rows = windowRows || stdout.rows || 24
  const columns = windowColumns || initialColumns || stdout.columns || 80
  // Owned here (not inside PromptInput) so this component's own layout math
  // below can read the buffer synchronously in the same render that
  // PromptInput reflects it in — a child→parent effect callback would lag
  // one commit behind, sizing the spacer for the *previous* frame's dropdown
  // and overflowing the terminal for one frame when e.g. `/` is typed.
  const [promptState, promptDispatch] = useReducer(bufferReducer, initialState)
  const commandMatchesCount = useMemo(() => commandQuery(promptState.value).matches.length, [promptState.value])
  const promptLineCount = useMemo(() => promptState.value.split('\n').length, [promptState.value])

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
      return total + countEventLines(event, event.seq <= state.replayThrough, getTool, getToolCall)
    }, 0)
    return bannerLines + eventLines
  }, [version, provider, model, cwd, columns, state.events, state.replayThrough, getTool, getToolCall])

  const statsLine = useMemo(() => {
    const stats = buildStatsLine(state.stats.sessionStats, state.stats.tokenUsage)
    const context = buildContextLine(state.stats.contextPressure)
    return [stats, context].filter(group => group !== '').join('| ')
  }, [state.stats])

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
    if (state.overlay.kind === 'trajectory') {
      return Math.max(10, rows - staticLines - 1)
    }
    if (state.overlay.kind === 'context') {
      return 7
    }
    if (state.overlay.kind === 'plugins') {
      return Math.max(10, rows - staticLines - 1)
    }
    if (state.overlay.kind === 'agentPresets') {
      return Math.max(10, rows - staticLines - 1)
    }
    if (state.overlay.kind === 'approval') {
      const reasonLine = state.overlay.approval.reason === undefined ? 0 : 1
      // title + tool line + reason? + 2 choices + footer
      return 1 + 1 + reasonLine + 2 + 1
    }
    if (state.overlay.kind === 'userQuestion') {
      const q = state.overlay.userQuestion
      const detailLineCount = q.detail === undefined ? 0 : q.detail.split('\n').length
      const detailLines = q.detail === undefined ? 0 : Math.min(60, detailLineCount) + (detailLineCount > 60 ? 1 : 0) + 2
      const optionLines = q.options.reduce((total, option) => total + 1 + (option.description === undefined ? 0 : 1), 0)
      const otherLine = q.options.length === 0 ? 0 : 1
      const customLine = q.options.length === 0 ? 1 : 0
      // header + question + detail + options + "Other…" + free-text field? + footer
      return 1 + 1 + detailLines + optionLines + otherLine + customLine + 1
    }
    const noticeLines = state.notice === undefined ? 0 : state.notice.split('\n').length
    const queuedLines = state.queued.length
    const streamingLines = state.streaming === undefined ? 0 : (formatStreamingText(state.streaming.text)?.split('\n').length ?? 0)
    const statusBarLines = 1
    const statsLines = statsLine === '' ? 0 : 1
    // 2 accounts for the prompt box's top/bottom border; promptLineCount is
    // its content rows, which grow with a multi-line draft.
    const promptLines = 2 + promptLineCount + commandMatchesCount
    const permissionLines = state.permission === undefined ? 0 : 1
    return noticeLines + queuedLines + streamingLines + statusBarLines + statsLines + promptLines + permissionLines
  }, [
    state.overlay,
    state.notice,
    state.queued.length,
    state.streaming,
    commandMatchesCount,
    promptLineCount,
    state.permission,
    statsLine,
    rows,
    staticLines,
  ])

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
            <EventLine key={item.event.seq} event={item.event} replay={item.replay} getTool={getTool} getToolCall={getToolCall} />
          )
        }
      </Static>
      <Box flexDirection="column">
        {spacerHeight > 0 && <Box height={spacerHeight} />}
        {state.overlay.kind === 'modelProfile' ? (
          <ModelProfileOverlay modelProfile={state.overlay.modelProfile} actions={actions} />
        ) : state.overlay.kind === 'trajectory' ? (
          <TrajectoryOverlay events={state.events} availableRows={dynamicLines} actions={actions} />
        ) : state.overlay.kind === 'context' ? (
          <ContextOverlay pressure={state.stats.contextPressure} breakdown={state.stats.contextBreakdown} actions={actions} />
        ) : state.overlay.kind === 'plugins' ? (
          <PluginsOverlay rows={state.overlay.rows} availableRows={dynamicLines} actions={actions} />
        ) : state.overlay.kind === 'agentPresets' ? (
          <AgentPresetsOverlay agentPresets={state.overlay.agentPresets} actions={actions} />
        ) : state.overlay.kind === 'approval' ? (
          <ApprovalOverlay approval={state.overlay.approval} actions={actions} />
        ) : state.overlay.kind === 'userQuestion' ? (
          <QuestionOverlay question={state.overlay.userQuestion} actions={actions} />
        ) : (
          <>
            {state.notice === undefined ? null : <Text>{state.notice}</Text>}
            <QueuedIndicator queued={state.queued} />
            <StreamingLine streaming={state.streaming} />
            <StatusBar
              sessionId={sessionId}
              provider={provider}
              model={model}
              status={state.status}
              queuedCount={state.queued.length}
              presetLabel={state.preset?.current}
            />
            <PromptInput
              status={state.status}
              actions={actions}
              state={promptState}
              dispatch={promptDispatch}
              history={promptHistory}
            />
            <PermissionIndicator permission={state.permission} />
            <StatsLine line={statsLine} />
          </>
        )}
      </Box>
    </Box>
  )
}
