import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { collectRenameSourceTexts, toKebabCase } from '../../src/tui/titleGeneration.js'

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

describe('toKebabCase', () => {
  it('lowercases and hyphenates a title-case sentence', () => {
    expect(toKebabCase('Merge Agents Resume Overlays')).toBe('merge-agents-resume-overlays')
  })

  it('strips punctuation the model wasn\'t asked to include', () => {
    expect(toKebabCase('Fix Auth Bug!!')).toBe('fix-auth-bug')
  })

  it('drops apostrophes instead of treating them as word breaks', () => {
    expect(toKebabCase("Don't Stop")).toBe('dont-stop')
  })

  it('collapses runs of whitespace/punctuation into a single hyphen', () => {
    expect(toKebabCase('too   many -- spaces')).toBe('too-many-spaces')
  })

  it('trims leading and trailing separators', () => {
    expect(toKebabCase('  leading and trailing  ')).toBe('leading-and-trailing')
  })

  it('leaves an already-kebab-case slug unchanged', () => {
    expect(toKebabCase('already-kebab-case')).toBe('already-kebab-case')
  })

  it('caps the word count at the default of 5', () => {
    expect(toKebabCase('one two three four five six seven')).toBe('one-two-three-four-five')
  })

  it('honors an explicit maxWords override', () => {
    expect(toKebabCase('one two three four five', 2)).toBe('one-two')
  })

  it('keeps non-Latin letters as their own word(s) instead of stripping them', () => {
    expect(toKebabCase('修复认证 bug')).toBe('修复认证-bug')
  })

  it('returns an empty string for input with no letters or digits', () => {
    expect(toKebabCase('!!! ---')).toBe('')
  })

  it('returns an empty string for empty input', () => {
    expect(toKebabCase('')).toBe('')
  })
})
