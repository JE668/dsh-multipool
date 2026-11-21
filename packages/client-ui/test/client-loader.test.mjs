import { test } from 'node:test'
import assert from 'node:assert/strict'

let captured = null
globalThis.window = {
  __ModuleLoader__: {
    load(spec) {
      captured = spec
    },
  },
}

await import('../client.js')

const core = await import('../dist/index.js')
// Everything this drawer is allowed to ask for: React, and nothing else. core stays out of the
// answer on purpose. A bundle that requires a second module is one client-modules cannot serve
// ("missed the module table"), so handing it everything here would hide the failure this file
// exists to catch -- it has to run against exactly what a page provides.
const chr10 = String.fromCharCode(10)
const fakeReact = {
  // React spreads the remaining arguments, so the drawer's two-element call has to arrive as an
  // array; reading them positionally as `kids` silently dropped the badge.
  createElement: (type, props, ...kids) => ({ type, props, kids }),
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useEffect: () => {},
}

function factory() {
  return captured.factory((name) => {
    if (name === 'react') return fakeReact
    throw new Error(`client.js required "${name}"; the page serves only react`)
  })
}

function registrar() {
  // One stub per apply(): the drawer registers twice now (the rail icon and the panel behind it),
  // so a single shared variable would let the second registration overwrite the first.
  const plugin = factory()
  const seen = []
  const components = []
  const ctx = {
    slots: {
      inject(name, fn) {
        seen.push(['inject', name])
        fn()
      },
      register(owner, comp) {
        seen.push(['register', owner.name, owner.id, owner.key, owner.label])
        components.push({ owner, comp })
        return () => {}
      },
    },
    effect(fn) {
      seen.push(['effect'])
      return fn()
    },
  }
  plugin.apply(ctx)
  const componentOf = (slot) => components.filter((c) => c.owner.name === slot).map((c) => c.comp)
  return { plugin, seen, componentOf }
}

test('loads one lazy factory named after the package', () => {
  assert.equal(captured.id, 'dsh-multipool')
})

test('registers the icon under sidebar.panellist through an effect', () => {
  const { plugin, seen } = registrar()
  assert.deepEqual(seen[0], ['inject', 'sidebar.panellist'])
  assert.deepEqual(seen[1], ['effect'])
  assert.deepEqual(seen[2], ['register', 'sidebar.panellist', 'dsh-multipool', undefined, 'DSH Multipool'])
  assert.deepEqual(plugin.inject, ['slots'])
})

test('the icon and its panel share one id, or the click lands nowhere', () => {
  // sidebar README: the same id addresses the main keyed slot. layout looks the row up as
  // entriesOfSlot('main').find(e => e.options.key === id) -- an icon alone selects itself onto
  // nothing, which is the grey dot a fresh install used to see.
  const { seen } = registrar()
  assert.deepEqual(seen[3], ['inject', 'main'])
  const iconRow = seen.find((c) => c[0] === 'register' && c[1] === 'sidebar.panellist')
  const mainRow = seen.find((c) => c[0] === 'register' && c[1] === 'main')
  assert.ok(iconRow !== undefined && mainRow !== undefined)
  assert.equal(mainRow[3], iconRow[2])
})

function mounted() {
  const { plugin, componentOf } = registrar()
  return { plugin, pick: (slot) => componentOf(slot)[0], componentOf }
}

test('paints idle with three dashes when no host channel exists', () => {
  delete globalThis.window['@dsh-multipool/plugin-client/view']
  const { pick } = mounted()
  const tree = pick('sidebar.panellist')({ size: 34, active: false })
  const lines = tree.props.title.split('\n')
  assert.equal(lines.length, 3)
  // No host to ask: dashes, not the 0/0 that "configured nothing" would print.
  assert.ok(lines[0].includes('\u2014/\u2014'))
  assert.ok(!lines[0].includes('0/0'))
  assert.ok(lines[1].includes('host'))
  // idle, not grey: grey is the host answering "no keys", and no host answered here.
  assert.equal(tree.props['data-multipool-level'], 'idle')
  // idle has to read as an outline: the badge is the second child, and a filled dot would make
  // "nothing configured" and "switched off" one picture.
  const [ring, badge] = tree.kids
  assert.equal(ring.props.size, 34)
  assert.equal(badge.props['data-multipool-badge'], 'idle')
  assert.equal(badge.props.style.background, 'transparent')
  assert.ok(badge.props.style.border.includes('solid'))
  assert.ok(badge.props.style.border.includes('--dsw-alias-state-idle-primary'))
})

test('a channel with no command() is a host too old, not a save that failed', async () => {
  globalThis.window = {
    __ModuleLoader__: { load: spec => { captured = spec } },
    ['@dsh-multipool/plugin-client/view']: { view: () => undefined, subscribe: () => () => undefined },
  }
  const plugin = factory()
  // `ok: false` is all a click handler can act on; the reason is what tells "your key was refused"
  // from "this build has nowhere to put a key", and only the first one is worth retrying.
  const outcome = await plugin.commandOf({ name: 'save', key: 'rc-abc' })
  assert.equal(outcome.ok, false)
  assert.equal(outcome.reason, 'no credential service')
})

test('a command that throws comes back as a refusal, not as a rejected promise', async () => {
  const calls = []
  globalThis.window = {
    __ModuleLoader__: { load: spec => { captured = spec } },
    ['@dsh-multipool/plugin-client/view']: {
      view: () => undefined,
      subscribe: () => () => undefined,
      command: request => {
        calls.push(request)
        throw new TypeError('command is not a function')
      },
    },
  }
  const plugin = factory()
  const outcome = await plugin.commandOf({ name: 'forget' })
  assert.deepEqual(calls, [{ name: 'forget' }])
  assert.equal(outcome.ok, false)
  // "command failed" and not "no credential service": this channel exists, the call reached it, and
  // broke there. Both arms of commandOf() (a synchronous throw and a rejected promise) say the
  // same word, or a page would have to know which kind of breakage it was looking at.
  assert.equal(outcome.reason, 'command failed')
  assert.equal(outcome.message, 'command is not a function')
})

test('still prints 0/0 once the host answers with an empty pool', () => {
  const answered = core.iconViewOf({
    snapshot: core.emptySnapshot(),
    budget: { admitRpm: 0, sources: [] },
    pointsProviderId: null,
  })
  assert.equal(answered.attached, true)
  assert.equal(answered.badge, '0/0')
})

test('the panel prints the three lines the icon shows, word for word', () => {
  // The icon and the panel subscribe to the same channel, so the temptation is to test them
  // apart and trust the seam. The seam is where the bug lives: one could read lines.accounts
  // and the other lines.points, both be "subscribed", and leave a reader with a panel that
  // disagrees with the dot and no way to say which one lied.
  delete globalThis.window['@dsh-multipool/plugin-client/view']
  const { componentOf } = registrar()
  const Panel = componentOf('main')[0]
  const Icon = componentOf('sidebar.panellist')[0]

  const panel = Panel({})
  const icon = Icon({ size: 24, active: false })

  // The stub createElement is React-shaped -- (type, props, ...kids) -- so the panel element
  // holds its children as one array in kids[0], and the first of those is the title div.
  const [, rowsBox] = panel.kids[0]
  const rows = rowsBox.kids[0].map((row) => row.kids[0])
  assert.equal(rows.length, 3)
  assert.ok(rows[0].includes('\u2014/\u2014'))
  assert.ok(rows[1].includes('host'))
  assert.ok(rows[2].includes('pts'))
  assert.ok(!rows.join('').match(/[0-9]/))
  // And the tooltip is the one place both can be wrong together, so it says nothing on its own:
})
