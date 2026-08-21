import { describe, expect, it, vi } from 'vitest'
import { checkForUpdate, isNewerVersion } from '../src/updateCheck.js'

describe('isNewerVersion', () => {
  it('reports a higher patch/minor/major part as newer', () => {
    expect(isNewerVersion('0.6.1', '0.6.0')).toBe(true)
    expect(isNewerVersion('0.7.0', '0.6.9')).toBe(true)
    expect(isNewerVersion('1.0.0', '0.9.9')).toBe(true)
  })

  it('reports the same or an older version as not newer', () => {
    expect(isNewerVersion('0.6.0', '0.6.0')).toBe(false)
    expect(isNewerVersion('0.5.9', '0.6.0')).toBe(false)
  })

  it('compares differing part counts as zero-padded', () => {
    expect(isNewerVersion('0.6', '0.6.0')).toBe(false)
    expect(isNewerVersion('0.6.0.1', '0.6.0')).toBe(true)
  })
})

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: () => Promise.resolve(body) } as Response
}

describe('checkForUpdate', () => {
  it('returns the registry version when newer than current', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ version: '0.7.0' }))
    const result = await checkForUpdate('@tomowang/dsh-tui', '0.6.0', { fetchImpl })
    expect(result).toBe('0.7.0')
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://registry.npmjs.org/@tomowang/dsh-tui/latest',
      expect.objectContaining({ signal: expect.anything() }),
    )
  })

  it('returns undefined when the registry version is not newer', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ version: '0.6.0' }))
    expect(await checkForUpdate('@tomowang/dsh-tui', '0.6.0', { fetchImpl })).toBeUndefined()
  })

  it('returns undefined on a non-ok response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ version: '0.7.0' }, false))
    expect(await checkForUpdate('@tomowang/dsh-tui', '0.6.0', { fetchImpl })).toBeUndefined()
  })

  it('returns undefined on a malformed body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}))
    expect(await checkForUpdate('@tomowang/dsh-tui', '0.6.0', { fetchImpl })).toBeUndefined()
  })

  it('returns undefined instead of throwing on a network error', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'))
    expect(await checkForUpdate('@tomowang/dsh-tui', '0.6.0', { fetchImpl })).toBeUndefined()
  })
})
