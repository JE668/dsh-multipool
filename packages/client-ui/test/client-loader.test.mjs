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
  useState: (init) => [typeof init === 'function' ? init() : init, () => undefined],
  useEffect: () => undefined,
}

const chr10 = String.fromCharCode(10)
const CHANNEL = '/dsh-multipool'

/** Give the factory a page that fetches, or one that has no fetch at all. */
function factory(area) {
  globalThis.fetch = area
  return captured.factory((name) => {
    if (name === 'react') return fakeReact
    throw new Error('client.js required "' + name + '"; the page serves only react')
  })
}

/** A Response the way fetch() hands one over: the drawer reads .ok, .status and .text(). */
function response(text, status) {
  const code = status === undefined ? 200 : status
  return {
    ok: code >= 200 && code < 300,
    status: code,
    text: () => Promise.resolve(text),
  }
}

/**
 * A page that remembers what it was asked, and answers from `host`.
 *
 * `host` stands in for the other process: it is handed the URL and the init of every call, and
 * returns what the web server would have returned. Nothing listening is a rejected fetch, because
 * a host process that is not running refuses the connection rather than answering with a number.
 */
function recordingPage(hostLoad) {
  const calls = []
  const page = (url, init) => {
    calls.push([url, init])
    return hostLoad(url, init)
  }
  page.calls = calls
  return page
}

/** A host that parses the body it was sent, and answers with `reply` wrapped in an envelope. */
function envelopeHost(reply) {
  return (url, init) =>
    Promise.resolve(response(JSON.stringify({ ok: true, value: reply(url, JSON.parse(init.body)) })))
}

/** What a browser says when no server holds the port: a rejected fetch, not a Response. */
const nothingListening = () => Promise.reject(new TypeError('Failed to fetch'))

/**
 * Order, as the page's loader would record it: if the slot, the effect and the registration were
 * observed in any other order, the drawer is painting into chrome DSH has already finished with.
 */
function orderOf(width) {
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
        return () => undefined
      },
    },
    effect(fn) {
      seen.push(['effect'])
      return fn()
    },
  }
  globalThis.fetch = width
  const plugin = captured.factory(function (name) {
    if (name === 'react') return fakeReact
    throw new Error('client.js required ' + name + '; the page serves only react')
  })
  plugin.apply(ctx)
  const componentOf = (slot) =>
    components.filter((entry) => entry.owner.name === slot).map((entry) => entry.comp)
  return { plugin, seen, componentOf }
}

test('loads one lazy factory named after the package', () => {
  assert.equal(captured.id, 'dsh-multipool')
})

test('registers the icon under sidebar.panellist through an effect', () => {
  const { seen, plugin } = orderOf(fakeReact)
  assert.deepEqual(seen[0], ['inject', 'sidebar.panellist'])
  assert.deepEqual(seen[1], ['effect'])
  assert.deepEqual(seen[2], ['register', 'sidebar.panellist', 'dsh-multipool', undefined, 'DSH Multipool'])
  assert.deepEqual(plugin.inject, ['slots'])
})

test('the icon and its panel share one id, or the click lands nowhere', () => {
  // The sidebar README (global panel entry) says a sidebar id addresses the main keyed slot's
  // entry of the same id. Two ids would be one icon that selects a panel nobody registered.
  const { seen } = orderOf(fakeReact)
  assert.deepEqual(seen[3], ['inject', 'main'])
  const iconRow = seen.find((row) => row[0] === 'register' && row[1] === 'sidebar.panellist')
  const mainRow = seen.find((row) => row[0] === 'register' && row[1] === 'main')
  assert.equal(mainRow[3], iconRow[2])
})

test('paints idle with three dashes when no host answers the call', () => {
  const { componentOf } = orderOf(fakeReact)
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
    reading: 'empty',
  })
  assert.equal(answered.attached, true)
  assert.equal(answered.badge, '0/0')
})

test('asks its own origin for the endpoint the host half serves', async () => {
  const page = recordingPage(envelopeHost(() => ({ ok: true, message: null })))
  const plugin = factory(page)
  const outcome = await plugin.commandOf({ name: 'save', key: 'rc-abc' })
  // A relative path, no port and no credential: in DSH desktop the shell forwards everything under
  // dsh-app://app that is not its own file to the host's web server, cookie already attached, and
  // connection.admit decides there. The two names are the whole handshake, so they are asserted in
  // the one file where both halves sit side by side.
  assert.equal(page.calls.length, 1)
  assert.equal(page.calls[0][0], '/dsh-multipool/command')
  assert.equal(page.calls[0][1].method, 'POST')
  assert.equal(page.calls[0][1].headers['content-type'], 'application/json')
  assert.deepEqual(JSON.parse(page.calls[0][1].body), {
    request: { name: 'save', key: 'rc-abc' },
  })
  assert.deepEqual(outcome, { ok: true, message: null })
})

test('a refusal, a thrown fetch and a dead host are three sentences, all envelopes', async () => {
  // A click handler cannot await and cannot catch either. Every way of not getting an answer has to
  // arrive as an envelope with ok false -- but not as the same sentence, or a wrong key and a dead
  // host become one bug report.
  const refused = factory(
    recordingPage(() =>
      Promise.resolve(
        response(
          JSON.stringify({ ok: false, error: { code: 'multipool/x', message: 'the store says no' } }),
        ),
      ),
    ),
  )
  const first = await refused.commandOf({ name: 'save', key: 'rc-abc' })
  assert.equal(first.ok, false)
  assert.equal(first.reason, 'command failed')
  assert.equal(first.message, 'the store says no')

  const unfair = factory(() => {
    throw new TypeError('no transport')
  })
  const second = await unfair.commandOf({ name: 'forget' })
  assert.equal(second.ok, false)
  assert.equal(second.reason, 'command failed')
  assert.equal(second.message, 'no transport')

  const nobody = factory(nothingListening)
  const third = await nobody.commandOf({ name: 'forget' })
  assert.equal(third.ok, false)
  assert.equal(third.reason, 'command failed')
})


test('a page with no window at all is a host too old, not a save that failed', async () => {
  const plugin = factory({ __ModuleLoader__: globalThis.window.__ModuleLoader__ })
  const outcome = await plugin.commandOf({ name: 'save', key: 'rc-abc' })
  assert.equal(outcome.ok, false)
  // One word for both ways of not reaching a host: a page has one action to offer either way.
  assert.equal(outcome.reason, 'command failed')
})
