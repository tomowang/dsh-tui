import { describe, expect, it } from 'vitest'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { RenderOptions } from '../../../src/render.js'
import { buildDetail } from '../../../src/tui/trajectory/detail.js'
import type { TrajectoryRecord } from '../../../src/tui/trajectory/types.js'

/** A minimal `TrajectoryRecord`, overridable per test — every field defaults to its "nothing extra" value. */
function record(overrides: Partial<TrajectoryRecord>): TrajectoryRecord {
  return {
    id: '1',
    kind: 'tool',
    turn: 1,
    step: 1,
    seq: 1,
    startedAt: 0,
    completedAt: undefined,
    label: 'label',
    isError: false,
    summary: 'summary',
    payload: undefined,
    result: undefined,
    reasoning: undefined,
    source: undefined,
    toolName: undefined,
    ...overrides,
  }
}

/** A `getTool` resolver serving one named tool, mirroring `render.test.ts`'s fixture. */
function toolResolver(name: string, tool: Partial<ToolDefinition>): RenderOptions['getTool'] {
  return toolName => (toolName === name ? (tool as ToolDefinition) : undefined)
}

describe('buildDetail — preview', () => {
  it('renders reasoning ahead of the payload text', () => {
    const text = buildDetail(record({ kind: 'assistant', payload: 'the answer', reasoning: 'thinking it through' }), 'preview', undefined)
    expect(text).toContain('✦ thinking')
    expect(text).toContain('thinking it through')
    expect(text).toContain('the answer')
    expect(text.indexOf('thinking it through')).toBeLessThan(text.indexOf('the answer'))
  })

  it('renders payload alone when there is no reasoning', () => {
    const text = buildDetail(record({ kind: 'user', payload: 'hello there' }), 'preview', undefined)
    expect(text).toContain('hello there')
    expect(text).not.toContain('thinking')
  })

  it('falls back to a placeholder with neither payload nor reasoning', () => {
    const text = buildDetail(record({ kind: 'assistant' }), 'preview', undefined)
    expect(text).toBe('(no content)')
  })
})

describe('buildDetail — raw', () => {
  it('includes an unrendered thinking marker ahead of the payload', () => {
    const text = buildDetail(record({ kind: 'assistant', payload: 'the answer', reasoning: 'thinking it through' }), 'raw', undefined)
    expect(text).toContain('[thinking]')
    expect(text).toContain('thinking it through')
    expect(text).toContain('the answer')
  })

  it('falls back to a placeholder with neither payload nor reasoning', () => {
    const text = buildDetail(record({ kind: 'context' }), 'raw', undefined)
    expect(text).toBe('(no content)')
  })
})

describe('buildDetail — source', () => {
  it('pretty-prints the captured source', () => {
    const text = buildDetail(record({ kind: 'user', source: { kind: 'user' } }), 'source', undefined)
    expect(text).toContain('"kind"')
    expect(text).toContain('"user"')
  })

  it('falls back to a placeholder with no source captured', () => {
    const text = buildDetail(record({ kind: 'assistant', source: undefined }), 'source', undefined)
    expect(text).toBe('(no source)')
  })
})

describe('buildDetail — schema', () => {
  it('renders the tool\'s declared name/description/parameters as JSON', () => {
    const getTool = toolResolver('read_file', {
      name: 'read_file',
      description: 'Reads a file',
      parameters: { type: 'object', properties: { path: { type: 'string' } } },
    })
    const text = buildDetail(record({ kind: 'tool', toolName: 'read_file' }), 'schema', getTool)
    expect(text).toContain('"name": "read_file"')
    expect(text).toContain('"description": "Reads a file"')
    expect(text).toContain('"path"')
  })

  it('falls back to unavailable when the tool is not registered', () => {
    const text = buildDetail(record({ kind: 'tool', toolName: 'missing_tool' }), 'schema', toolResolver('read_file', {}))
    expect(text).toBe('Schema unavailable')
  })

  it('falls back to unavailable for an unmatched result with no known tool name', () => {
    const text = buildDetail(record({ kind: 'tool', toolName: undefined }), 'schema', toolResolver('read_file', {}))
    expect(text).toBe('Schema unavailable')
  })

  it('falls back to unavailable with no getTool resolver at all', () => {
    const text = buildDetail(record({ kind: 'tool', toolName: 'read_file' }), 'schema', undefined)
    expect(text).toBe('Schema unavailable')
  })
})
