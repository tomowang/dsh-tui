import { describe, expect, it } from 'vitest'
import { buildTitledBorder, isPlainBorder } from '../../src/tui/titledBorder.js'

const ESC = '\x1b['
const noColor = (s: string): string => s
const blue = (s: string): string => `${ESC}38;2;79;107;254m${s}${ESC}0m`

describe('isPlainBorder', () => {
  it('recognizes an unstyled bare run of dashes at the exact width', () => {
    expect(isPlainBorder('─'.repeat(20), 20)).toBe(true)
  })

  it('recognizes a colored bare run of dashes once SGR is stripped', () => {
    expect(isPlainBorder(blue('─'.repeat(20)), 20)).toBe(true)
  })

  it('rejects a run of dashes at the wrong length', () => {
    expect(isPlainBorder('─'.repeat(19), 20)).toBe(false)
    expect(isPlainBorder('─'.repeat(21), 20)).toBe(false)
  })

  it("rejects pi-tui's own scroll indicator", () => {
    expect(isPlainBorder(`─── ↑ 3 more ${'─'.repeat(7)}`, 20)).toBe(false)
  })

  it('rejects an empty line', () => {
    expect(isPlainBorder('', 20)).toBe(false)
  })
})

describe('buildTitledBorder', () => {
  it('right-aligns the title with exactly one separating space', () => {
    const result = buildTitledBorder(20, 'explore-dir', noColor)
    expect(result).toBeDefined()
    // eslint-disable-next-line no-control-regex -- stripping this test's own bold wrapper to check the plain text shape.
    const plain = result!.replace(/\x1b\[[0-9;]*m/g, '')
    expect(plain).toBe('──────── explore-dir')
    expect(plain.length).toBe(20)
  })

  it('applies bold to the title text', () => {
    const result = buildTitledBorder(20, 'explore-dir', noColor)
    expect(result).toContain(`${ESC}1m`)
  })

  it('applies borderColor to both the dash fill and the title', () => {
    const result = buildTitledBorder(20, 'ab', blue)
    // Once for the dash run, once for the title — borderColor wraps each independently.
    expect(result?.split(`${ESC}38;2;79;107;254m`).length).toBe(3)
  })

  it('uses zero dashes when the title plus one space exactly fills the width', () => {
    const result = buildTitledBorder(12, 'explore-dir', noColor)
    // eslint-disable-next-line no-control-regex -- stripping this test's own bold wrapper to check the plain text shape.
    expect(result?.replace(/\x1b\[[0-9;]*m/g, '')).toBe(' explore-dir')
  })

  it('returns undefined when the title cannot fit even with zero dashes', () => {
    expect(buildTitledBorder(11, 'explore-dir', noColor)).toBeUndefined()
  })

  it('returns undefined for a title wider than the whole box', () => {
    expect(buildTitledBorder(5, 'explore-dir', noColor)).toBeUndefined()
  })
})
