import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { collectRenameSourceTexts } from '../../src/tui/titleGeneration.js'

/** Build a minimal event fixture; collectRenameSourceTexts only ever reads `.type`/`.data`. */
function event(type: string, data: unknown): SessionEvent {
  return { type, seq: 1, time: 0, data } as unknown as SessionEvent
}

function userMessage(text: string): SessionEvent {
  return event('user/message', { source: { kind: 'user' }, content: [{ type: 'text', text }] })
}

describe('collectRenameSourceTexts', () => {
  it('collects a single eligible human message', () => {
    expect(collectRenameSourceTexts([userMessage('fix the auth bug')])).toEqual(['fix the auth bug'])
  })

  it('collects multiple eligible messages in log order', () => {
    const events = [userMessage('first'), userMessage('second'), userMessage('third')]
    expect(collectRenameSourceTexts(events)).toEqual(['first', 'second', 'third'])
  })

  it('trims surrounding whitespace off each message', () => {
    expect(collectRenameSourceTexts([userMessage('  padded text  ')])).toEqual(['padded text'])
  })

  it('drops a whitespace-only message', () => {
    expect(collectRenameSourceTexts([userMessage('   ')])).toEqual([])
  })

  it('drops a message with no text content (e.g. image-only)', () => {
    const events = [event('user/message', { source: { kind: 'user' }, content: [{ type: 'image', url: 'x' }] })]
    expect(collectRenameSourceTexts(events)).toEqual([])
  })

  it('excludes a plugin-injected user/message (subdir AGENTS.md, skill content, cron notices, …)', () => {
    const events = [event('user/message', { source: { kind: 'plugin' }, content: [{ type: 'text', text: 'injected context' }] })]
    expect(collectRenameSourceTexts(events)).toEqual([])
  })

  it('excludes a tool-sourced user/message', () => {
    const events = [event('user/message', { source: { kind: 'tool' }, content: [{ type: 'text', text: 'tool output' }] })]
    expect(collectRenameSourceTexts(events)).toEqual([])
  })

  it('ignores every other event type entirely', () => {
    const events = [
      event('turn/start', { turn: 1 }),
      userMessage('the only eligible one'),
      event('assistant/message', { turn: 1, step: 1, message: {} }),
    ]
    expect(collectRenameSourceTexts(events)).toEqual(['the only eligible one'])
  })

  it('joins multiple text blocks within one message', () => {
    const events = [event('user/message', {
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'part one' }, { type: 'text', text: 'part two' }],
    })]
    expect(collectRenameSourceTexts(events)).toEqual(['part onepart two'])
  })

  it('returns an empty array for an empty log', () => {
    expect(collectRenameSourceTexts([])).toEqual([])
  })
})
