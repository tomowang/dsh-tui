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
import { createInterface } from 'node:readline'
import type { Interface } from 'node:readline'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { Agent, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
// Empty type imports carry the loader Context merge for the mount await
// and the cmdline Context merge for the appExit host value.
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-cmdline'

import { renderEvent } from './render.js'
import type { RenderIo } from './render.js'

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
interface TuiIo extends RenderIo {
  /** Request process exit with `code` after the tree disposes. */
  exit(code: number): void
}

/** The process stream the TUI writes to; tests substitute a capture. */
export const internals: { stdout: RenderIo } = {
  stdout: process.stdout,
}

/** Report an unexpected front-door failure and request a failing exit. */
function fail(io: TuiIo, error: unknown): void {
  io.write(`dsh-tui: ${error instanceof Error ? error.message : String(error)}\n`)
  io.exit(1)
}

/**
 * Drive one interactive session: create or resume the Agent, replay its log,
 * follow live session events, and loop on terminal line input.
 * @param ctx - plugin context carrying the Agent, default model, and Session services.
 * @param config - validated startup config.
 * @param io - process-facing effects.
 */
async function run(ctx: Context, config: Config, io: TuiIo): Promise<void> {
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

  // Replay persisted history, then follow the same log live; the seq boundary
  // keeps one rendering pass per event across the two phases.
  let renderedThrough = 0
  for (const event of agent.session.events) {
    renderEvent(event, io, { replay: true })
    renderedThrough = event.seq
  }
  ctx.on('session/event', (session, event) => {
    if (session !== agent.session) return
    if (event.seq <= renderedThrough) return
    renderedThrough = event.seq
    renderEvent(event, io, { replay: false })
  })

  startLineLoop(ctx, agent, io, () => shutdown())

  let closing = false
  async function shutdown(): Promise<void> {
    if (closing) return
    closing = true
    agent.cancel({ kind: 'user' })
    await agent.whenIdle()
    await sessions?.flush(agent.session)
    io.exit(0)
  }

  io.write(`session ${String(agent.session.id)} · ${selection.provider}/${selection.model}\n`)
  io.write('type a message; /status for a snapshot; /exit to quit\n\n')
}

/**
 * Own the readline surface: prompt while idle, steer while running, and route
 * the terminal-only commands. The readline handle is an effect so plugin
 * disposal always releases stdin.
 */
function startLineLoop(ctx: Context, agent: Agent, io: TuiIo, shutdown: () => Promise<void>): void {
  let status: 'idle' | 'running' = 'idle'
  const rl: Interface = createInterface({ input: process.stdin, output: process.stdout, prompt: '› ' })
  ctx.effect(() => () => rl.close())

  ctx.on('agent/status', (payload) => {
    if (payload.agent !== agent) return
    status = payload.status === 'running' ? 'running' : 'idle'
    if (status === 'idle') rl.prompt(true)
  })

  rl.on('line', (line) => {
    const text = line.trim()
    if (text === '') {
      if (status === 'idle') rl.prompt()
      return
    }
    if (text === '/exit' || text === '/quit') {
      void shutdown()
      return
    }
    if (text === '/status') {
      io.write(`session ${String(agent.session.id)} · ${status} · ${agent.session.events.length} logged events\n`)
      if (status === 'idle') rl.prompt()
      return
    }
    const message = createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'user' },
    })
    // An idle driver opens a turn from follow-up; a running one takes steering.
    if (status === 'running') agent.steer(message)
    else agent.followup(message)
  })

  rl.on('SIGINT', () => {
    if (status === 'running') {
      agent.cancel({ kind: 'user' })
      return
    }
    void shutdown()
  })

  rl.prompt()
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
  void run(ctx, config, io).catch((error: unknown) => { fail(io, error) })
}
