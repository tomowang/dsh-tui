import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { load } from 'js-yaml'
import { applyEntryPatches, entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { Config as SubagentConfig } from '@deepseek-ai/dsh-tool-subagent'

const require = createRequire(import.meta.url)
const baseRequire = createRequire(import.meta.resolve('@deepseek-ai/dsh-base'))
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

function readYaml(path: string | URL): unknown {
  return load(readFileSync(path, 'utf8'), { schema: entryListSchema })
}

const base = applyEntryPatches([], readYaml(baseRequire.resolve('@deepseek-ai/dsh-base/cordis.patch.yml')) as PatchOptions[], () => {})
const patches = manifest.dsh.bundle.patch.flatMap((path: string) => readYaml(new URL(`../${path}`, import.meta.url))) as PatchOptions[]
const warnings = vi.fn()
const composed = applyEntryPatches(base, patches, warnings)
const presets = composed.filter(row => row.name === '@deepseek-ai/dsh-agent-preset')

function allRows(rows: EntryOptions[]): EntryOptions[] {
  return rows.flatMap(row => [row, ...allRows(row.group ? row.config as EntryOptions[] : [])])
}

describe('published DSH base bundle compatibility', () => {
  it('applies every patch target without warnings and declares all four presets', () => {
    expect(warnings.mock.calls).toEqual([])
    expect(presets.map(row => row.config.id)).toEqual(['standard', 'ptc', 'minimal', 'cordis'])
    expect(composed.find(row => row.id === 'hmr')?.disabled).toBe(true)
    expect(composed.find(row => row.id === 'tool-agent-team')?.disabled).not.toBe(true)
  })

  it.each(presets)('resolves active plugin entry points for $id', async preset => {
    const rows = allRows(preset.config.plugins as EntryOptions[])
    for (const row of rows) {
      if (row.group || row.disabled === true) continue
      let resolved: string
      try {
        resolved = require.resolve(row.name)
      } catch {
        resolved = baseRequire.resolve(row.name)
      }
      const plugin = await import(pathToFileURL(resolved).href)
      expect(plugin.apply ?? plugin.default, row.name).toBeDefined()
      if (row.name === '@deepseek-ai/dsh-tool-subagent') {
        const config = SubagentConfig(row.config)
        if (row.id === 'tool-subagent') {
          expect(config.modelSelection).toBe(true)
          expect(config.modelDiscovery).toBe(true)
        }
      }
    }
  })
})
