import { describe, expect, it, vi } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { TuiStore } from '../../src/tui/store.js'

function event(seq: number): SessionEvent {
  return { type: 'user/message', seq, time: 0, data: { source: { kind: 'user' }, content: [] } } as unknown as SessionEvent
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
