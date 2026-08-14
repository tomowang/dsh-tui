/**
 * @tomowang/dsh-tui — interactive terminal front door. The bundle patch rides
 * over dsh-base without Host, HTTP, or browser plugins; this runner creates
 * (or resumes) one Agent through the core registry, projects the durable
 * session log to the terminal, and feeds line input back as follow-up or
 * steering messages until the reader exits.
 *
 * The plugin owns terminal input and presentation only; agent lifecycle,
 * session persistence, tool execution, and model policy remain separate
 * composition entries, so any dsh-base row stays patchable underneath it.
 *
 * @module @tomowang/dsh-tui
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
// Empty type imports carry the loader Context merge for the mount await
// and the cmdline Context merge for the appExit host value.
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-cmdline'
import type { Instance } from 'ink'

import { TuiStore } from './tui/store.js'
import { mountTui } from './tui/mount.js'
import type { TuiActions } from './tui/App.js'

/** Stable Cordis plugin name. */
export const name = 'tui'

/** Core services required before the interactive loop can start. */
export const inject = ['agentDefaultModel', 'agents', 'sessions']

/** Plugin config: startup values resolved from this app's provider service. */
export interface Config {
  /** Session id to resume; absent starts a fresh session. */
  resume?: string
}

export const Config: z<Config> = z.object({
  resume: z.string(),
})

/** Process-facing effects of the interactive loop; tests substitute captures. */
interface TuiIo {
  write(chunk: string): unknown
  /** Request process exit with `code` after the tree disposes. */
  exit(code: number): void
}

/** The process stream the TUI writes to and mounts Ink on; tests substitute a capture. */
export const internals: { stdout: NodeJS.WriteStream } = {
  stdout: process.stdout,
}

/** Report an unexpected front-door failure and request a failing exit. */
function fail(io: TuiIo, error: unknown, instance: Instance | undefined): void {
  instance?.unmount()
  io.write(`dsh-tui: ${error instanceof Error ? error.message : String(error)}\n`)
  io.exit(1)
}

/**
 * Drive one interactive session: create or resume the Agent, replay its log,
 * follow live session events, and mount the Ink front end for input.
 * @param ctx - plugin context carrying the Agent, default model, and Session services.
 * @param config - validated startup config.
 * @param io - process-facing effects.
 * @param mounted - written once Ink mounts, so a later rejection can unmount before reporting.
 */
async function run(ctx: Context, config: Config, io: TuiIo, mounted: { instance?: Instance }): Promise<void> {
  // Loader siblings mount concurrently. Await the complete application before
  // creating an Agent so its scoped tools and adapters are not half-composed.
  await ctx.get('loader')?.await()
  const agents = ctx.get('agents')
  const defaultModel = ctx.get('agentDefaultModel')
  const sessions = ctx.get('sessions')
  // Early process shutdown can dispose the tree while settlement is pending.
  if (agents === undefined || defaultModel === undefined || sessions === undefined) return

  const selection = defaultModel.currentSelection()
  const sessionId = SessionId(config.resume ?? `session-${randomUUID()}`)
  const { agent } = await agents.create({
    sessionId,
    meta: { cwd: process.cwd() },
    agentOptions: { provider: selection.provider, model: selection.model },
    setup: (agentCtx) => {
      const selected: ModelSelectionRef = { current: selection, assembled: undefined }
      installModelSelection(agentCtx, selected)
    },
  })
  await agent.whenIdle()

  io.write(`session ${String(agent.session.id)} · ${selection.provider}/${selection.model}\n`)
  io.write('type a message; /status for a snapshot; /exit to quit\n\n')

  // Seed the store from persisted history, then follow the same log live; the
  // store's seq boundary keeps one rendering pass per event across replay and
  // live phases, and `--resume` starts with any pending inbox already shown.
  const store = new TuiStore({ events: agent.session.events })
  store.setStatus(agent.status)
  store.setQueued([...agent.inbox.nextStep, ...agent.inbox.nextTurn])

  ctx.on('session/event', (session, event) => {
    if (session !== agent.session) return
    store.appendEvent(event)
  })
  ctx.on('agent/status', (payload) => {
    if (payload.agent !== agent) return
    store.setStatus(payload.status)
  })
  const resnapshotQueue = (): void => {
    store.setQueued([...agent.inbox.nextStep, ...agent.inbox.nextTurn])
  }
  ctx.on('agent/inbox/inserted', (payload) => {
    if (payload.agent !== agent) return
    resnapshotQueue()
  })
  ctx.on('agent/inbox/claimed', (payload) => {
    if (payload.agent !== agent) return
    resnapshotQueue()
  })
  ctx.on('agent/inbox/discarded', (payload) => {
    if (payload.agent !== agent) return
    resnapshotQueue()
  })

  let closing = false
  async function shutdown(): Promise<void> {
    if (closing) return
    closing = true
    agent.cancel({ kind: 'user' })
    await agent.whenIdle()
    await sessions?.flush(agent.session)
    instance.unmount()
    io.exit(0)
  }

  const actions: TuiActions = {
    send(text) {
      store.setNotice(undefined)
      const message = createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'user' },
      })
      // An idle driver opens a turn from follow-up; a running one takes steering.
      if (agent.status === 'running') agent.steer(message)
      else agent.followup(message)
    },
    cancel() {
      agent.cancel({ kind: 'user' })
    },
    shutdown() {
      void shutdown()
    },
    status() {
      store.setNotice(`session ${String(agent.session.id)} · ${agent.status} · ${agent.session.events.length} logged events`)
    },
  }

  const instance = mountTui({
    store,
    actions,
    sessionId: String(agent.session.id),
    provider: selection.provider,
    model: selection.model,
    stdout: internals.stdout,
    stdin: process.stdin,
  })
  mounted.instance = instance
  // The Ink instance is the effect: plugin disposal must always release stdin.
  ctx.effect(() => () => instance.unmount())
}

/**
 * Mount the interactive front door. Requires real TTYs on both stdin and
 * stdout and fails loud instead of silently degrading, so pipes and CI keep
 * using headless mode.
 * @param ctx - plugin context carrying core services and the launcher-provided exit request.
 * @param config - validated startup config.
 */
export function apply(ctx: Context, config: Config): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('dsh-tui: stdin and stdout must both be TTYs; use `dsh --profile headless` for pipes')
  }
  // Read through the global service store, not the property proxy: appExit is
  // an optional host value, never an injected dependency.
  const exit = ctx.get('appExit')
  if (exit === undefined) {
    throw new Error('dsh-tui: the launcher must provide ctx.appExit before the tree mounts')
  }
  const io: TuiIo = { write: chunk => internals.stdout.write(chunk), exit }
  const mounted: { instance?: Instance } = {}
  void run(ctx, config, io, mounted).catch((error: unknown) => { fail(io, error, mounted.instance) })
}
