import { describe, expect, it } from 'vitest'
import type { GoalProjection } from '@deepseek-ai/dsh-goal'
import type { SubagentRow } from '../../src/tui/agents/types.js'
import { buildAgentsStripText, buildGoalBarText, buildTerminalTitle, buildUpdateHintText } from '../../src/tui/liveText.js'

/** A minimal 'goal' projection fixture; only the fields the strip reads are meaningful. */
function projection(over: Partial<GoalProjection['goal']> = {}): GoalProjection {
  return {
    goal: {
      id: 'goal-1',
      revision: 1,
      objective: 'Ship the redesign',
      phase: 'active',
      maxGoalRounds: 256,
      ...over,
    },
    roundsStarted: 0,
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('buildGoalBarText', () => {
  it('renders nothing while loading (projection unit not composed), absent, or cleared', () => {
    expect(buildGoalBarText(undefined)).toBe('')
    expect(buildGoalBarText(null)).toBe('')
  })

  it('renders nothing for a complete goal, mirroring the web GoalBar', () => {
    expect(buildGoalBarText(projection({ phase: 'complete' }))).toBe('')
  })

  it('shows the phase label and truncated objective for an active goal', () => {
    const text = buildGoalBarText(projection())
    expect(text).toContain('active')
    expect(text).toContain('Ship the redesign')
    expect(text).toContain('🎯')
  })

  it('shows the paused phase label', () => {
    expect(buildGoalBarText(projection({ phase: 'paused' }))).toContain('paused')
  })

  it('appends the blocker code and message for a blocked goal', () => {
    const text = buildGoalBarText(projection({
      phase: 'blocked',
      blockedReason: { code: 'round-limit', message: 'Goal reached its configured limit of 256 rounds.' },
    }))
    expect(text).toContain('blocked')
    expect(text).toContain('round-limit')
    expect(text).toContain('Goal reached its configured limit of 256 rounds.')
  })

  it('truncates a long objective to the strip cap', () => {
    const text = buildGoalBarText(projection({ objective: 'x'.repeat(200) }))
    expect(text).toContain('…')
    // '🎯 active · ' prefix + the 80-char truncated objective, plus ANSI codes.
    expect(text.length).toBeLessThan(200)
  })
})

describe('buildTerminalTitle', () => {
  it('falls back to the bare product name while loading or without the session-title service composed', () => {
    expect(buildTerminalTitle(undefined)).toBe('dsh-tui')
    expect(buildTerminalTitle(null)).toBe('dsh-tui')
  })

  it('suffixes the accepted session title with the product name', () => {
    expect(buildTerminalTitle('Read-only agent preset creation')).toBe('Read-only agent preset creation — dsh-tui')
  })
})

function childRow(id: string, label: string, activity: 'running' | 'inactive' = 'running'): SubagentRow {
  return { kind: 'child', id, label, mode: 'continuable', activity, hasChildren: false }
}

function diagnosticRow(id: string): SubagentRow {
  return { kind: 'diagnostic', id, diagnostic: 'corrupt' }
}

describe('buildAgentsStripText', () => {
  it('renders nothing for a session with no subagent children', () => {
    expect(buildAgentsStripText([], undefined)).toBe('')
  })

  it('renders nothing when only diagnostic rows exist — none has a transcript to switch to', () => {
    expect(buildAgentsStripText([diagnosticRow('bad-1')], undefined)).toBe('')
  })

  it('renders nothing once every subagent has finished — an ephemeral indicator, not a permanent log', () => {
    expect(buildAgentsStripText([childRow('c1', 'Fix auth bug', 'inactive')], undefined)).toBe('')
  })

  it('still shows a finished child as long as a sibling from the same batch is still running', () => {
    const rows = [childRow('c1', 'Fix auth bug', 'inactive'), childRow('c2', 'Reptile cold-blooded evolution', 'running')]
    const text = buildAgentsStripText(rows, undefined)
    expect(text).not.toBe('')
    expect(text).toContain('Fix auth bug')
  })

  it('always leads with a main segment, before any child', () => {
    const text = buildAgentsStripText([childRow('c1', 'Fix auth bug')], undefined)
    expect(text.indexOf('main')).toBeLessThan(text.indexOf('Fix auth bug'))
  })

  it('shows every child label, in listChildren order', () => {
    const rows = [childRow('c1', 'Fix auth bug'), childRow('c2', 'Reptile cold-blooded evolution')]
    const text = buildAgentsStripText(rows, undefined)
    expect(text).toContain('Fix auth bug')
    expect(text).toContain('Reptile cold-blooded evolution'.slice(0, 23))
  })

  it('marks main solid while no detail view is open', () => {
    const text = buildAgentsStripText([childRow('c1', 'Fix auth bug')], undefined)
    expect(text).toContain('●')
  })

  it('marks the viewed child solid instead of main once its detail view is open', () => {
    const text = buildAgentsStripText([childRow('c1', 'Fix auth bug')], 'c1')
    // One solid circle for the viewed child, one hollow circle for main.
    expect(text.split('●').length - 1).toBe(1)
    expect(text.split('○').length - 1).toBe(1)
  })

  it('truncates a long label to the strip cap', () => {
    const text = buildAgentsStripText([childRow('c1', 'x'.repeat(200))], undefined)
    expect(text).toContain('…')
  })

  it('includes the arrow-key hint', () => {
    expect(buildAgentsStripText([childRow('c1', 'Fix auth bug')], undefined)).toContain('←/→')
  })

  function manyChildren(count: number): SubagentRow[] {
    return Array.from({ length: count }, (_unused, i) => childRow(`c${i}`, `child-${i}`))
  }

  it('shows every child with no hidden-count markers when 4 or fewer exist', () => {
    const text = buildAgentsStripText(manyChildren(4), undefined)
    for (let i = 0; i < 4; i++) expect(text).toContain(`child-${i}`)
    expect(text).not.toContain('‹')
    expect(text).not.toContain('›')
  })

  it('windows down to at most 4 children when more exist, marking the rest hidden', () => {
    const text = buildAgentsStripText(manyChildren(6), undefined)
    // No selection: the window defaults to the front (indices 0-3).
    for (let i = 0; i < 4; i++) expect(text).toContain(`child-${i}`)
    expect(text).not.toContain('child-4')
    expect(text).not.toContain('child-5')
    expect(text).toContain('2›') // 2 children past the window's end.
    expect(text).not.toContain('‹')
  })

  it('slides the window to keep the viewed child visible even past the front 4', () => {
    const text = buildAgentsStripText(manyChildren(6), 'c5')
    expect(text).toContain('child-5')
    expect(text).toContain('‹') // some earlier children are now hidden instead.
  })

  it('keeps main in the strip regardless of which children the window scrolls past', () => {
    const text = buildAgentsStripText(manyChildren(6), 'c5')
    expect(text).toContain('main')
  })
})

describe('buildUpdateHintText', () => {
  it('renders nothing while unchecked or already current', () => {
    expect(buildUpdateHintText('0.6.0', undefined)).toBe('')
  })

  it('shows the current and newer version plus the upgrade command once one is found', () => {
    const text = buildUpdateHintText('0.6.0', '0.7.0')
    expect(text).toContain('0.6.0')
    expect(text).toContain('0.7.0')
    expect(text).toContain('dsh plugin --profile tui add @tomowang/dsh-tui')
  })
})
