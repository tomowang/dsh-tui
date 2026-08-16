import { describe, expect, it, vi } from 'vitest'
import type { TuiActions } from '../../src/tui/PromptInput.js'
import { matchSlashCommands, runSlashCommand } from '../../src/tui/commands.js'

function stubActions(): TuiActions {
  return {
    send: vi.fn(),
    cancel: vi.fn(),
    shutdown: vi.fn(),
    status: vi.fn(),
    recordHistory: vi.fn(),
    clear: vi.fn(),
    cyclePermission: vi.fn(),
    compact: vi.fn(),
    ensureFileIndex: vi.fn(),
    openModelProfile: vi.fn(),
    closeModelProfile: vi.fn(),
    backToProviderList: vi.fn(),
    selectProvider: vi.fn(),
    createProvider: vi.fn(),
    editProvider: vi.fn(),
    saveProvider: vi.fn(),
    deleteProvider: vi.fn(),
    discoverModelsForDraft: vi.fn(),
    setActiveModel: vi.fn(),
    openTrajectory: vi.fn(),
    closeTrajectory: vi.fn(),
    openContext: vi.fn(),
    closeContext: vi.fn(),
    openPlugins: vi.fn(),
    closePlugins: vi.fn(),
    openAgentPresets: vi.fn(),
    closeAgentPresets: vi.fn(),
    selectAgentPresetRow: vi.fn(),
    applyAgentPreset: vi.fn(),
  }
}

function totalCalls(actions: TuiActions): number {
  return Object.values(actions).reduce((total, fn) => total + (fn as ReturnType<typeof vi.fn>).mock.calls.length, 0)
}

describe('matchSlashCommands', () => {
  it('filters by prefix', () => {
    expect(matchSlashCommands('/m').map(c => c.command)).toEqual(['/model'])
  })

  it('matches every command against the bare slash', () => {
    expect(matchSlashCommands('/').length).toBeGreaterThanOrEqual(5)
  })

  it('matches a command against its own full text', () => {
    expect(matchSlashCommands('/status').map(c => c.command)).toEqual(['/status'])
  })

  it('returns nothing for a non-matching query', () => {
    expect(matchSlashCommands('/nope')).toEqual([])
  })

  it('is case-sensitive', () => {
    expect(matchSlashCommands('/M')).toEqual([])
  })
})

describe('runSlashCommand', () => {
  it('dispatches /exit to shutdown', () => {
    const actions = stubActions()
    runSlashCommand('/exit', actions)
    expect(actions.shutdown).toHaveBeenCalledTimes(1)
    expect(totalCalls(actions)).toBe(1)
  })

  it('dispatches /quit to shutdown', () => {
    const actions = stubActions()
    runSlashCommand('/quit', actions)
    expect(actions.shutdown).toHaveBeenCalledTimes(1)
    expect(totalCalls(actions)).toBe(1)
  })

  it('dispatches /status to status', () => {
    const actions = stubActions()
    runSlashCommand('/status', actions)
    expect(actions.status).toHaveBeenCalledTimes(1)
    expect(totalCalls(actions)).toBe(1)
  })

  it('dispatches /clear to clear', () => {
    const actions = stubActions()
    runSlashCommand('/clear', actions)
    expect(actions.clear).toHaveBeenCalledTimes(1)
    expect(totalCalls(actions)).toBe(1)
  })

  it('dispatches /model to openModelProfile', () => {
    const actions = stubActions()
    runSlashCommand('/model', actions)
    expect(actions.openModelProfile).toHaveBeenCalledTimes(1)
    expect(totalCalls(actions)).toBe(1)
  })

  it('dispatches /trajectory to openTrajectory', () => {
    const actions = stubActions()
    runSlashCommand('/trajectory', actions)
    expect(actions.openTrajectory).toHaveBeenCalledTimes(1)
    expect(totalCalls(actions)).toBe(1)
  })

  it('dispatches /context to openContext', () => {
    const actions = stubActions()
    runSlashCommand('/context', actions)
    expect(actions.openContext).toHaveBeenCalledTimes(1)
    expect(totalCalls(actions)).toBe(1)
  })

  it('dispatches /plugins to openPlugins', () => {
    const actions = stubActions()
    runSlashCommand('/plugins', actions)
    expect(actions.openPlugins).toHaveBeenCalledTimes(1)
    expect(totalCalls(actions)).toBe(1)
  })

  it('dispatches /presets to openAgentPresets', () => {
    const actions = stubActions()
    runSlashCommand('/presets', actions)
    expect(actions.openAgentPresets).toHaveBeenCalledTimes(1)
    expect(totalCalls(actions)).toBe(1)
  })

  it('dispatches /compact to compact', () => {
    const actions = stubActions()
    runSlashCommand('/compact', actions)
    expect(actions.compact).toHaveBeenCalledTimes(1)
    expect(totalCalls(actions)).toBe(1)
  })

  it('calls nothing for an unrecognized command', () => {
    const actions = stubActions()
    runSlashCommand('/nope', actions)
    expect(totalCalls(actions)).toBe(0)
  })
})
