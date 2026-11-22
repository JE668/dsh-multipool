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
const fakeReact = {
  // React spreads the remaining arguments, so the drawer's two-element call has to arrive as an
  // array; reading them positionally as `kids` silently dropped the badge.
  createElement: (type, props, ...kids) => ({ type, props, kids }),
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useEffect: () => {},
}

const chr10 = String.fromCharCode(10)
const BRIDGE = 'dsh-multipool:bridge'
const REPLY = 'dsh-multipool:bridge-reply'

function factory(win) {
  if (win !== undefined) globalThis.window = win
  return captured.factory((name) => {
    if (name === 'react') return fakeReact
    throw new Error(`client.js required "${name}"; the page serves only react`)
  })
}

/** A host that is not running: nobody answers, so the asker's timeout is the whole answer. */
const silentHost = () => undefined

/**
 * A window carrying the two events the bridge speaks, used the way client.js uses them.
 *
 * `host` stands in for the other process. It is handed each dispatched event and returns the
 * reply detail to deliver a microtask later, or nothing when no host is listening -- which is the
 * case the timeout is for.
 */
function busWindow(host) {
  const listing = []
  const asked = []
  const win = {
    asked,
    listening: listing,
    addEventListener(type, listener) {
      listing.push([type, listener])
    },
    removeEventListener(type, listener) {
      const at = listing.findIndex((pair) => pair[0] === type && pair[1] === listener)
      if (at >= 0) listing.splice(at, 1)
    },
    dispatchEvent(event) {
      asked.push(event)
      if (typeof host !== 'function') return
      const answer = host(event)
      if (answer === undefined) return
      queueMicrotask(() => {
        for (const [type, listener] of [...listing]) {
          if (type === REPLY) listener({ type: type, detail: answer })
        }
      })
    },
  }
  return win
}

function snapshotHost(view) {
  return (event) => {
    if (event.type !== BRIDGE || event.detail.endpoint !== 'snapshot') return undefined
    return { callId: event.detail.callId, ok: true, value: view }
  }
}

function commandHost(said) {
  return (event) => {
    if (event.type !== BRIDGE || event.detail.endpoint !== 'command') return undefined
    return { callId: event.detail.callId, ok: true, value: said }
  }
}

function registrar(win) {
  // One stub per apply(): the drawer registers twice now (the rail icon and the panel behind it),
  // so a single shared variable would let the second registration overwrite the first.
  globalThis.window = win
  const plugin = factory(win)
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
  return { plugin, seen, asked: win.asked, componentOf }
}

test('loads one lazy factory named after the package', () => {
  assert.equal(captured.id, 'dsh-multipool')
})

test('registers the icon under sidebar.panellist through an effect', () => {
  const { seen, plugin } = registrar(busWindow(silentHost))
  assert.deepEqual(seen[0], ['inject', 'sidebar.panellist'])
  assert.deepEqual(seen[1], ['effect'])
  assert.deepEqual(seen[2], ['register', 'sidebar.panellist', 'dsh-multipool', undefined, 'DSH Multipool'])
  assert.deepEqual(plugin.inject, ['slots'])
})

test('the icon and its panel share one id, or the click lands nowhere', () => {
  // The sidebar README (global panel entry) says a sidebar id addresses the main keyed slot's
  // entry of the same id. Two ids would be one icon that selects a panel nobody registered.
  const { seen } = registrar(busWindow(silentHost))
  assert.deepEqual(seen[3], ['inject', 'main'])
  const iconRow = seen.find((row) => row[0] === 'register' && row[1] === 'sidebar.panellist')
  const mainRow = seen.find((row) => row[0] === 'register' && row[1] === 'main')
  assert.equal(mainRow[3], iconRow[2])
})

test('paints idle with three dashes when no host answers the call', () => {
  const { componentOf } = registrar(busWindow(silentHost))
  const Icon = componentOf('sidebar.panellist')[0]
  const tree = Icon({ size: 24, active: false })
  // Nothing has been read yet, so this is the shape the component starts in -- not a state it
  // moved to after a failed call.
  assert.equal(tree.props['data-multipool-level'], 'idle')
  assert.equal(tree.props['data-multipool-active'], 'false')
  const lines = tree.props.title.split(chr10)
  assert.equal(lines.length, 3)
  assert.ok(lines[0].includes('\u2014/\u2014'))
  assert.ok(!lines[0].includes('0/0'))
  assert.ok(lines[1].includes('host'))
  // And it is not a badge at all: an unheard host is not an empty pool, so there is no fraction.
  const badge = tree.kids[1]
  assert.equal(badge.props.style.background, 'transparent')
  assert.ok(badge.props.style.border.includes('var(--dsw-alias-state-idle-primary)'))
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

test('asks the host on its two events, and sends the request as given', async () => {
  const page = busWindow((event) => ({
    callId: event.detail.callId,
    ok: true,
    value: { ok: true, message: null },
  }))
  const plugin = factory(page)
  const outcome = await plugin.commandOf({ name: 'save', key: 'rc-abc' })
  // The two event names are the whole handshake between the halves, so they are asserted here and
  // not only over in plugin-dsh: this is the one file where both halves sit side by side.
  // A real CustomEvent, not a literal: dispatchEvent refuses anything else, and this stub is a
  // fake window, so nothing here would have enforced that on our behalf.
  assert.equal(page.asked.length, 1)
  assert.ok(page.asked[0] instanceof CustomEvent)
  assert.equal(page.asked[0].type, 'dsh-multipool:bridge')
  assert.deepEqual(page.asked[0].detail, {
    callId: 'multipool-1',
    endpoint: 'command',
    payload: { request: { name: 'save', key: 'rc-abc' } },
  })
  assert.deepEqual(outcome, { ok: true, message: null })
})

test('a throw or a rejection comes back as a refusal, not as a rejected promise', async () => {
  // A click handler cannot await and cannot catch. Whatever went wrong on the way to the host has
  // to arrive as an envelope with ok: false, or the button that sends the key does nothing at all.
  const throwing = factory(busWindow(() => {
    throw new TypeError('no transport')
  }))
  const first = await throwing.commandOf({ name: 'forget' })
  assert.equal(first.ok, false)
  assert.equal(first.reason, 'command failed')
  assert.equal(first.message, 'no credential service')

  // A host that never answers is not a different shape from one that threw: both leaves settled.
  const second = await factory(busWindow(silentHost)).commandOf({ name: 'forget' })
  assert.equal(second.ok, false)
  assert.equal(second.reason, 'command failed')
  assert.equal(second.message, 'no credential service')
})

test('a page with no window at all is a host too old, not a save that failed', async () => {
  const plugin = factory({ __ModuleLoader__: globalThis.window.__ModuleLoader__ })
  const outcome = await plugin.commandOf({ name: 'save', key: 'rc-abc' })
  assert.equal(outcome.ok, false)
  // One word for both ways of not reaching a host: a page has one action to offer either way.
  assert.equal(outcome.reason, 'command failed')
})

test('the panel prints the same three lines the icon tooltip carries', () => {
  // The icon and the panel ask the same snapshot endpoint, so the temptation is to test them apart
  // and trust the seam. The seam is where the bug lives: one could read lines.accounts and the other
  // lines.points, both "answered", and leave a reader with a panel that disagrees with the dot and no
  // way to say which one lied. So the panel is rendered off the view the icon tooltip already shows.
  const empty = core.iconViewOf({
    snapshot: core.emptySnapshot(),
    budget: { admitRpm: 0, sources: [] },
    pointsProviderId: null,
    attached: false,
  })
  const Panel = registrar(busWindow(snapshotHost(empty))).componentOf('main')[0]
  const Icon = registrar(busWindow(snapshotHost(empty))).componentOf('sidebar.panellist')[0]

  const icon = Icon({ size: 24, active: false })
  const panel = Panel({})
  const rows = panel.kids[0][1].kids[0].map((row) => row.kids[0])

  assert.equal(icon.props['data-multipool-level'], 'idle')
  assert.deepEqual(rows, icon.props.title.split(chr10))
  assert.deepEqual(rows, [empty.lines.accounts, empty.lines.rpm, empty.lines.points])
  assert.ok(!rows.join('').match(/[0-9]/))
})
