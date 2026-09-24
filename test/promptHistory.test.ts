import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appendPromptHistory, loadPromptHistory } from '../src/promptHistory.js'

describe('prompt history file', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dsh-tui-history-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('reads a missing file as an empty history', () => {
    expect(loadPromptHistory(join(dir, 'absent.jsonl'))).toEqual([])
  })

  it('round-trips appended lines oldest first, creating the directory on demand', async () => {
    const path = join(dir, 'nested', 'history.jsonl')
    await appendPromptHistory(path, 'first')
    await appendPromptHistory(path, 'multi\nline "quoted"')
    expect(loadPromptHistory(path)).toEqual(['first', 'multi\nline "quoted"'])
    expect(readFileSync(path, 'utf8').split('\n').filter(Boolean)).toHaveLength(2)
  })

  it('skips malformed and non-string lines instead of discarding the file', () => {
    const path = join(dir, 'history.jsonl')
    writeFileSync(path, '"ok"\n{torn\n42\n"also ok"\n')
    expect(loadPromptHistory(path)).toEqual(['ok', 'also ok'])
  })
})
