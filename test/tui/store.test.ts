import { describe, expect, it, vi } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { TuiStore } from '../../src/tui/store.js'

function event(seq: number): SessionEvent {
  return { type: 'user/message', seq, time: 0, data: { source: { kind: 'user' }, content: [] } } as unknown as SessionEvent
}

function chunkEvent(seq: number, turn: number, step: number, chunk: unknown): SessionEvent {
  return { type: 'assistant/chunk', seq, time: 0, data: { turn, step, chunk } } as unknown as SessionEvent
}

function assistantMessageEvent(seq: number, turn: number, step: number): SessionEvent {
  return {
    type: 'assistant/message',
    seq,
    time: 0,
    data: { turn, step, message: { role: 'assistant', content: [] } },
  } as unknown as SessionEvent
}

describe('TuiStore construction', () => {
  it('seeds replayThrough from the last seeded event', () => {
    const store = new TuiStore({ events: [event(1), event(2), event(5)] })
    expect(store.getSnapshot().replayThrough).toBe(5)
  })

  it('starts replayThrough at 0 for an empty session', () => {
    const store = new TuiStore({ events: [] })
    expect(store.getSnapshot().replayThrough).toBe(0)
  })
})

describe('TuiStore.appendEvent', () => {
  it('appends and notifies for a seq greater than the current max', () => {
    const store = new TuiStore({ events: [event(1)] })
    const listener = vi.fn()
    store.subscribe(listener)

    store.appendEvent(event(2))

    expect(store.getSnapshot().events.map(e => e.seq)).toEqual([1, 2])
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('silently drops a duplicate/out-of-order seq', () => {
    const store = new TuiStore({ events: [event(1), event(2)] })
    const listener = vi.fn()
    store.subscribe(listener)
    const before = store.getSnapshot()

    store.appendEvent(event(2))
    store.appendEvent(event(1))

    expect(store.getSnapshot()).toBe(before)
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('TuiStore streaming', () => {
  it('folds text-delta chunks into streaming.text without adding to events', () => {
    const store = new TuiStore({ events: [] })

    store.appendEvent(chunkEvent(1, 1, 1, { type: 'block-start', index: 0, blockType: 'text' }))
    store.appendEvent(chunkEvent(2, 1, 1, { type: 'text-delta', index: 0, text: 'Hel' }))
    store.appendEvent(chunkEvent(3, 1, 1, { type: 'text-delta', index: 0, text: 'lo' }))

    const snapshot = store.getSnapshot()
    expect(snapshot.streaming).toEqual({ turn: 1, step: 1, text: 'Hello' })
    expect(snapshot.events).toEqual([])
  })

  it('resets the accumulator when turn/step changes', () => {
    const store = new TuiStore({ events: [] })

    store.appendEvent(chunkEvent(1, 1, 1, { type: 'block-start', index: 0, blockType: 'text' }))
    store.appendEvent(chunkEvent(2, 1, 1, { type: 'text-delta', index: 0, text: 'first step' }))
    store.appendEvent(chunkEvent(3, 1, 2, { type: 'block-start', index: 0, blockType: 'text' }))
    store.appendEvent(chunkEvent(4, 1, 2, { type: 'text-delta', index: 0, text: 'second step' }))

    expect(store.getSnapshot().streaming).toEqual({ turn: 1, step: 2, text: 'second step' })
  })

  it('assistant/message clears streaming and appends the settled event', () => {
    const store = new TuiStore({ events: [] })

    store.appendEvent(chunkEvent(1, 1, 1, { type: 'block-start', index: 0, blockType: 'text' }))
    store.appendEvent(chunkEvent(2, 1, 1, { type: 'text-delta', index: 0, text: 'partial' }))
    store.appendEvent(assistantMessageEvent(3, 1, 1))

    const snapshot = store.getSnapshot()
    expect(snapshot.streaming).toBeUndefined()
    expect(snapshot.events.map(e => e.seq)).toEqual([3])
  })

  it('drops persisted assistant/chunk rows from the seeded events without seeding streaming', () => {
    const store = new TuiStore({
      events: [event(1), chunkEvent(2, 1, 1, { type: 'text-delta', index: 0, text: 'stale' }), assistantMessageEvent(3, 1, 1)],
    })

    const snapshot = store.getSnapshot()
    expect(snapshot.events.map(e => e.seq)).toEqual([1, 3])
    expect(snapshot.streaming).toBeUndefined()
    expect(snapshot.replayThrough).toBe(3)
  })
})

describe('TuiStore.setStatus', () => {
  it('is a no-op for the same value', () => {
    const store = new TuiStore({ events: [] })
    const listener = vi.fn()
    store.subscribe(listener)
    const before = store.getSnapshot()

    store.setStatus('idle')

    expect(store.getSnapshot()).toBe(before)
    expect(listener).not.toHaveBeenCalled()
  })

  it('notifies on a real transition', () => {
    const store = new TuiStore({ events: [] })
    const listener = vi.fn()
    store.subscribe(listener)

    store.setStatus('running')

    expect(store.getSnapshot().status).toBe('running')
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe('TuiStore setters without an equality guard', () => {
  it('setQueued always notifies, even with an equal-looking value', () => {
    const store = new TuiStore({ events: [] })
    const listener = vi.fn()
    store.subscribe(listener)

    store.setQueued([])
    store.setQueued([])

    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('setNotice updates the field and notifies', () => {
    const store = new TuiStore({ events: [] })
    store.setNotice('hello')
    expect(store.getSnapshot().notice).toBe('hello')
  })

  it('setPermission updates the field and notifies', () => {
    const store = new TuiStore({ events: [] })
    store.setPermission({ current: 'default', names: ['default'] })
    expect(store.getSnapshot().permission).toEqual({ current: 'default', names: ['default'] })
  })

  it('setStats updates the field and notifies', () => {
    const store = new TuiStore({ events: [] })
    const stats = { sessionStats: undefined, tokenUsage: undefined, contextPressure: undefined, contextBreakdown: undefined }
    store.setStats(stats)
    expect(store.getSnapshot().stats).toBe(stats)
  })

  it('setPreset updates the field and notifies', () => {
    const store = new TuiStore({ events: [] })
    store.setPreset({ current: 'Code mode', blank: true })
    expect(store.getSnapshot().preset).toEqual({ current: 'Code mode', blank: true })
  })
})

describe('TuiStore.subscribe', () => {
  it('stops notifying after the returned disposer is called', () => {
    const store = new TuiStore({ events: [] })
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)

    unsubscribe()
    store.setStatus('running')

    expect(listener).not.toHaveBeenCalled()
  })
})

describe('TuiStore overlay state machine', () => {
  it('openModelProfile opens a loading provider list', () => {
    const store = new TuiStore({ events: [] })
    store.openModelProfile()
    const overlay = store.getSnapshot().overlay
    expect(overlay.kind).toBe('modelProfile')
    if (overlay.kind === 'modelProfile') {
      expect(overlay.modelProfile.view).toBe('list')
      expect(overlay.modelProfile.busy).toBe(true)
      expect(overlay.modelProfile.providers).toBeUndefined()
    }
  })

  it('closeOverlay restores the closed state', () => {
    const store = new TuiStore({ events: [] })
    store.openModelProfile()
    store.closeOverlay()
    expect(store.getSnapshot().overlay).toEqual({ kind: 'none' })
  })

  it('openContext opens the context overlay', () => {
    const store = new TuiStore({ events: [] })
    store.openContext()
    expect(store.getSnapshot().overlay).toEqual({ kind: 'context' })
  })

  it('openPlugins opens the plugins overlay with the given rows', () => {
    const store = new TuiStore({ events: [] })
    const rows = [{ id: 'tui', name: '@tomowang/dsh-tui', disabled: false, group: false, state: 'active' as const }]

    store.openPlugins(rows)

    expect(store.getSnapshot().overlay).toEqual({ kind: 'plugins', rows })
  })

  it('openAgentPresets opens a loading roster seeded with the session state', () => {
    const store = new TuiStore({ events: [] })
    store.openAgentPresets({ current: 'standard', blank: true })
    const overlay = store.getSnapshot().overlay
    expect(overlay.kind).toBe('agentPresets')
    if (overlay.kind === 'agentPresets') {
      expect(overlay.agentPresets).toEqual({ rows: [], selected: 0, current: 'standard', blank: true, busy: true, error: undefined })
    }
  })

  it('updateAgentPresets is a no-op while the overlay is closed', () => {
    const store = new TuiStore({ events: [] })
    const listener = vi.fn()
    store.subscribe(listener)
    const before = store.getSnapshot()

    store.updateAgentPresets({ busy: false })

    expect(store.getSnapshot()).toBe(before)
    expect(listener).not.toHaveBeenCalled()
  })

  it('updateAgentPresets merges a patch onto the open overlay', () => {
    const store = new TuiStore({ events: [] })
    store.openAgentPresets({ current: undefined, blank: true })
    const rows = [{ id: 'standard', label: 'Standard mode', description: undefined, trust: 'system' as const, broken: undefined }]

    store.updateAgentPresets({ rows, busy: false })

    const overlay = store.getSnapshot().overlay
    expect(overlay.kind).toBe('agentPresets')
    if (overlay.kind === 'agentPresets') {
      expect(overlay.agentPresets.rows).toBe(rows)
      expect(overlay.agentPresets.busy).toBe(false)
      // Untouched fields survive the merge.
      expect(overlay.agentPresets.blank).toBe(true)
    }
  })

  it('selectAgentPresetRow moves the overlay cursor', () => {
    const store = new TuiStore({ events: [] })
    store.openAgentPresets({ current: undefined, blank: true })

    store.selectAgentPresetRow(2)

    const overlay = store.getSnapshot().overlay
    expect(overlay.kind).toBe('agentPresets')
    if (overlay.kind === 'agentPresets') expect(overlay.agentPresets.selected).toBe(2)
  })

  it('updateModelProfile is a no-op while the overlay is closed', () => {
    const store = new TuiStore({ events: [] })
    const listener = vi.fn()
    store.subscribe(listener)
    const before = store.getSnapshot()

    store.updateModelProfile({ busy: false })

    expect(store.getSnapshot()).toBe(before)
    expect(listener).not.toHaveBeenCalled()
  })

  it('updateModelProfile merges a patch onto the open overlay', () => {
    const store = new TuiStore({ events: [] })
    store.openModelProfile()

    store.updateModelProfile({ busy: false, error: 'boom' })

    const overlay = store.getSnapshot().overlay
    expect(overlay.kind).toBe('modelProfile')
    if (overlay.kind === 'modelProfile') {
      expect(overlay.modelProfile.busy).toBe(false)
      expect(overlay.modelProfile.error).toBe('boom')
      // Untouched fields survive the merge.
      expect(overlay.modelProfile.view).toBe('list')
    }
  })
})
