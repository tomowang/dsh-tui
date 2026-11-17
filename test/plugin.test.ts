import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { MountOptions } from '../src/tui/TuiApp.js'
import { mountTui, restoreActiveTerminal } from '../src/tui/TuiApp.js'
import { apply, internals } from '../src/index.js'

vi.mock('../src/tui/TuiApp.js', () => ({
  mountTui: vi.fn(() => ({ unmount: vi.fn(), waitUntilExit: async () => {} })),
  restoreActiveTerminal: vi.fn(),
}))
vi.mock('../src/promptHistory.js', () => ({
  defaultPromptHistoryPath: () => '/unused/history.jsonl',
  loadPromptHistory: () => [],
  appendPromptHistory: async () => {},
}))
vi.mock('../src/updateCheck.js', () => ({ checkForUpdate: async () => undefined }))

const originalTty = [process.stdin, process.stdout].map(stream => Object.getOwnPropertyDescriptor(stream, 'isTTY'))

afterEach(() => {
  ;[process.stdin, process.stdout].forEach((stream, index) => {
    const descriptor = originalTty[index]
    if (descriptor === undefined) Reflect.deleteProperty(stream, 'isTTY')
    else Object.defineProperty(stream, 'isTTY', descriptor)
  })
  vi.restoreAllMocks()
  vi.mocked(mountTui).mockClear()
  process.removeListener('exit', restoreActiveTerminal)
})

async function start(resume?: string) {
  const ctx = new Context()
  const scoped = new Context()
  const exit = vi.fn()
  const session = {
    id: 'session-existing',
    snapshotEvents: () => [{
      type: 'user/message', seq: 1, time: 0,
      data: createUserMessage({ content: [{ type: 'text', text: 'Fix authentication' }], source: { kind: 'user' } }),
    }],
  }
  const selected = { provider: 'saved-provider', model: 'saved-model' }
  const agent = {
    session, ctx: scoped, status: 'idle',
    inbox: { nextStep: [], nextTurn: [] },
    model: { current: () => selected },
    whenIdle: async () => {},
  }
  const create = vi.fn(async ({ setup }) => {
    await setup(scoped, agent)
    return { agent, dispose: async () => {} }
  })
  const snapshot = vi.fn(() => ({ values: { title: 'Existing title', goal: null } }))
  const rename = vi.fn((_session, title: string) => ({ title }))
  const stream = vi.fn(async function* () {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'Fix authentication' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Fix authentication' } }
  })
  const services = {
    appExit: exit,
    agents: { create, resume: create },
    sessions: {},
    agentDefaultModel: { currentSelection: () => ({ provider: 'default-provider', model: 'default-model', reasoningEffort: 'off' }) },
    sessionProjections: { snapshot, onChanged: () => () => {} },
    sessionTitle: { rename },
    llm: { stream },
    subagents: { listDescendants: async () => [
      { kind: 'child', id: 'named-child', name: 'reviewer', label: 'Review code', mode: 'continuable', activity: 'running', hasChildren: false, depth: 1 },
      { kind: 'child', id: 'legacy-child', label: 'Old child', mode: 'one-shot', activity: 'inactive', hasChildren: false, depth: 1 },
    ] },
  }
  // Keep the real Cordis event/effect APIs; substitute only external services.
  vi.spyOn(ctx, 'get').mockImplementation(name => Reflect.get(services, name))
  Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true })
  Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true })
  vi.spyOn(internals.stdout, 'write').mockImplementation(() => true)
  apply(ctx, { resume })
  await vi.waitFor(() => expect(mountTui).toHaveBeenCalledOnce())
  expect(exit).not.toHaveBeenCalled()
  const options: MountOptions = vi.mocked(mountTui).mock.calls[0][0]
  return { options, create, snapshot, stream, rename }
}

describe('DSH release integration', () => {
  it('starts with the persisted model and preserves the configured effort fallback', async () => {
    const { options, create, snapshot } = await start('existing')
    expect(create.mock.calls[0][0]).toMatchObject({
      resumeSessionId: 'session-existing',
      agentOptions: { provider: 'default-provider', model: 'default-model', reasoningEffort: 'off' },
    })
    expect(options).toMatchObject({ provider: 'saved-provider', model: 'saved-model' })
    expect(snapshot.mock.calls[0][1]).toEqual([
      'sessionStats', 'tokenUsage', 'contextPressure', 'contextBreakdown', 'goal', 'title', 'agentPreset',
    ])
    expect(options.store.getSnapshot().agentsStrip.map(row => row.kind === 'child' ? row.label : '')).toEqual(['Old child', 'reviewer'])
  })

  it('uses the session model and a producer-owned purpose for on-demand rename', async () => {
    const { options, stream, rename } = await start('existing')
    options.actions.rename('')
    await vi.waitFor(() => expect(rename, JSON.stringify(options.store.getSnapshot().notice)).toHaveBeenCalled())
    expect(stream.mock.calls[0][0]).toMatchObject({
      provider: 'saved-provider', model: 'saved-model', purpose: 'dsh-tui-title', sessionId: 'session-existing',
    })
    expect(rename.mock.calls[0][1]).toBe('fix-authentication')
  })
})
