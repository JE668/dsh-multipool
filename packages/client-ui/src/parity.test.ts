import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { type IconViewInput, iconLevelOf, iconViewOf } from './icon-state.js'
import { emptySnapshot } from '@dsh-multipool/core'

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
    expect(view.lines.rpm).toContain('账号池')
  })

  /**
   * The lines are where the two copies actually diverge, and the level test above cannot see it.
   *
   * 'unread' only changes the badge and the wording; the counts stay whatever the snapshot holds.
   * A copy that never learned the third word still returns a correct level for POOL_EMPTY and still
   * prints '0/0' -- so it passes that test and tells the user, in a tooltip, that their pool has been
   * counted and holds nothing. Every field is compared here for that reason, not just the level.
   */
  it('agrees on what to paint when the pool was never read', () => {
    const input: IconViewInput = {
      snapshot: emptySnapshot(),
      budget: { admitRpm: 0, sources: [] },
      pointsProviderId: null,
      reading: 'unread',
    }
    const typed = iconViewOf(input)
    const drawn = drawer.iconViewOf(input)
    expect(drawn).toEqual(typed)
    expect(drawn.badge).toBe('\u2014/\u2014')
    expect(drawn.level).toBe('idle')
    expect(drawn.counts.reading).toBe('unread')
  })

  it('agrees that a host which answered with no keys is zero of zero', () => {
    const input: IconViewInput = {
      snapshot: emptySnapshot(),
      budget: { admitRpm: 11, sources: ['min(20,30)*0.85/1.5=11'] },
      pointsProviderId: null,
      reading: 'empty',
    }
    expect(drawer.iconViewOf(input)).toEqual(iconViewOf(input))
    expect(drawer.iconViewOf(input).badge).toBe('0/0')
  })

  it('prints no digits anywhere when the pool was never read', () => {
    const drawn = drawer.iconViewOf({
      snapshot: emptySnapshot(),
      budget: { admitRpm: 0, sources: [] },
      pointsProviderId: null,
      reading: 'unread',
    })
    const text = drawn.badge + drawn.lines.accounts + drawn.lines.rpm + drawn.lines.points
    expect(text).not.toMatch(/[0-9]/)
    // emptyView() is the drawer's pre-answer placeholder: unattached as well as unread. That is a
    // third state, not this one, so it is compared with the drawer's own empty input rather than
    // with a view whose host did answer the question.
    const placeholder = drawer.emptyView()
    const empty = drawer.iconViewOf({
      snapshot: emptySnapshot(),
      budget: { admitRpm: 0, sources: [] },
      pointsProviderId: null,
      attached: false,
      reading: 'unread',
    })
    expect(placeholder).toEqual(empty)
  })

  it('takes the absent reading as unread, not as zero', () => {
    const absent: IconViewInput = {
      snapshot: emptySnapshot(),
      budget: { admitRpm: 0, sources: [] },
      pointsProviderId: null,
    }
    expect(drawer.iconViewOf(absent)).toEqual(iconViewOf(absent))
  })

  it('registers into the three slots layout addresses by one id', () => {
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
    // Google is a subsection inside the single dsh-multipool settings section, not its own slot.
    expect(registered.map((r) => r.name)).toEqual(['sidebar.panellist', 'main', 'settings.section'])
    expect(registered[0]?.id).toBe(registered[1]?.key)
    expect(registered[2]?.id).toBe(registered[0]?.id)
    void dispose
  })
})
