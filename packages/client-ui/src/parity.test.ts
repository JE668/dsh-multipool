import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { iconLevelOf } from './icon-state.js'

const drawerPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'client.js')

/**
 * Loads the drawer the way the page does.
 *
 * client-modules serves client.js as one opaque file, so it cannot import this module and
 * carries a second copy of the same arithmetic instead. Two copies of one rule drift, and the
 * drift is invisible: the tests above keep passing while the copy the user actually sees is the
 * one nothing checks. So this file registers the drawer against a stub loader, runs it once to
 * capture the factory, and holds both halves to one answer over shared inputs.
 *
 * Only `react` is served from the module table, exactly as the page serves it.
 */
function loadDrawer(): Record<string, any> {
  const source = readFileSync(drawerPath, 'utf8')
  let captured: any = null

  const reactStub = {
    createElement(type: unknown, props: unknown) {
      return { type, props: props === null ? {} : props }
    },
    useState(init: unknown) {
      const first = typeof init === 'function' ? (init as () => unknown)() : init
      return [first, () => undefined]
    },
    useEffect() {
      return undefined
    },
  }

  const moduleLoader = {
    load(spec: unknown) {
      captured = spec
    },
  }

  // eslint-disable-next-line no-new-func
  const run = new Function('window', 'require', source + String.fromCharCode(10) + 'return 0')
  run({ __ModuleLoader__: moduleLoader }, (name: string) => {
    if (name !== 'react') {
      throw new Error('the drawer required "' + name + '", which the page does not serve')
    }
    return reactStub
  })

  if (captured === null) throw new Error('client.js did not register a module')
  if (captured.id !== 'dsh-multipool') throw new Error('the drawer registered as ' + String(captured.id))
  return captured.factory((name: string) => {
    if (name !== 'react') throw new Error('the drawer required "' + name + '", which the page does not serve')
    return reactStub
  })
}

const drawer = loadDrawer()

const POOL_EMPTY = { available: 0, total: 0, providerId: 'all' }
const POOL_DEAD = { available: 0, total: 3, providerId: 'all' }
const POOL_PART = { available: 1, total: 3, providerId: 'all' }
const POOL_FULL = { available: 3, total: 3, providerId: 'all' }

describe('client.js carries the same arithmetic as icon-state.ts', () => {
  it('agrees on the level of every pool a host can answer with', () => {
    const cases = [
      { overall: POOL_EMPTY, configured: false, attached: true, expect: 'grey' },
      { overall: POOL_EMPTY, configured: false, attached: false, expect: 'idle' },
      { overall: POOL_DEAD, configured: true, attached: true, expect: 'red' },
      { overall: POOL_PART, configured: true, attached: true, expect: 'yellow' },
      { overall: POOL_FULL, configured: true, attached: true, expect: 'green' },
    ]
    for (const c of cases) {
      // icon-state.ts takes attached as an optional third argument; the drawer's copy requires it.
      expect(iconLevelOf(c.overall as never, c.configured, c.attached)).toBe(c.expect)
      expect(drawer.iconLevelOf(c.overall, c.configured, c.attached)).toBe(c.expect)
        }
  })

  it('starts on the idle empty pool, with an em dash and no digits', () => {
    const view = drawer.emptyView()
    expect(view.level).toBe('idle')
    expect(view.attached).toBe(false)
    expect(view.lines.points).not.toMatch(/[0-9]/)
    expect(view.lines.rpm).toContain('host')
  })

  it('registers into the two slots layout pairs by one id', () => {
    expect(drawer.inject).toEqual(['slots'])
    const registered: Array<{ name: string; key?: string; id?: string }> = []
    const ctx = {
      slots: {
        inject(_name: string, fn: () => void) {
          fn()
        },
        register(owner: { name: string; key?: string; id?: string }) {
          registered.push(owner)
          return () => undefined
        },
      },
      effect(fn: () => unknown) {
        return fn()
      },
    }
    const dispose = drawer.apply(ctx)
    expect(registered.map((r) => r.name)).toEqual(['sidebar.panellist', 'main'])
    expect(registered[0]?.id).toBe(registered[1]?.key)
    void dispose
  })
})
