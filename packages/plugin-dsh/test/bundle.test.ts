import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../..')
const repoRoot = process.cwd().endsWith('plugin-dsh') ? resolve(process.cwd(), '../..') : repo

/** Read one package.json out of the workspace. */
function pkg(relative: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(repoRoot, relative), 'utf8')) as Record<string, unknown>
}

describe('the workspace is one DSH bundle', async () => {
  const root = pkg('package.json')
    // the host half's built entry: what a DSH profile actually loads as a plugin
    const host = (await import('../dist/index.js')) as Record<string, unknown>
  const plugin = pkg('packages/plugin-dsh/package.json')
  const client = pkg('packages/client-ui/package.json')

  it('declares itself as the bundle a profile installs', () => {
    expect(root.name).toBe('dsh-multipool')
    const dsh = root.dsh as Record<string, unknown>
    expect(dsh.manifestVersion).toBe(1)
    expect(dsh.bundle).toEqual({ patch: './cordis.patch.yml' })
    expect((dsh.client as Record<string, unknown>).platform).toBe('web')
  })

  it('has a host entry that can actually run apply()', () => {
    const exports = root.exports as Record<string, string>
    // built output, not source: .dsh installs have no ts runner in front of them
    expect(exports['.']).toEqual({
      types: './packages/plugin-dsh/dist/index.d.ts',
      default: './packages/plugin-dsh/dist/index.js',
    })
    expect(root.main).toBe('./packages/plugin-dsh/dist/index.js')
    expect(root.types).toBe('./packages/plugin-dsh/dist/index.d.ts')
    // the browser half is served from the package it lives in, not copied
    expect(exports['./client']).toBe('./packages/client-ui/client.js')
    // cordis.patch.yml reads these two off the installed bundle, so they must survive .dsh
    expect(exports['./cordis.patch.yml']).toBe('./cordis.patch.yml')
    expect((root.files as string[])).toContain('cordis.patch.yml')
  })

  it('keeps the three packages private and out of the published bundle', () => {
    expect(plugin.private).toBe(true)
    expect(client.private).toBe(true)
  })

  it('registers its browser bundle under the name the loader row carries', () => {
    // client-modules opens <row.name>/client.js refined by the row's rev, then asks
    // __ModuleLoader__.load for that very id. A bundle that announces its own package name
    // instead loads fine and registers nothing: "loaded without registering ... via
    // __ModuleLoader__.load". Only the root package reaches the row, so it is the root name.
    const source = readFileSync(join(repoRoot, 'packages/client-ui/client.js'), 'utf8')
    const declared = /__ModuleLoader__\.load\(\{\s*id:\s*'([^']+)'/.exec(source)
    expect(declared?.[1]).toBe(root.name)
  })

  it('does not wait on a service that only the browser half provides', () => {
    // `slots` is provided by dsh-cordis-client-runner, which runs in the page, not in this
    // process. Declaring it here parks the entry in "pending (waiting for service: slots)"
    // forever: the host fiber never becomes ready, so apply() never runs and the icon is
    // never registered. apply() reads ctx.effect and nothing else, so it waits on nothing.
    expect(host.inject).toBeUndefined()
  })
})
