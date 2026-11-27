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
    Promise.resolve(response(JSON.stringify({ ok: true, value: reply(url, JSON.parse(init.body === 'null' ? '{}' : init.body)) })))
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
  // Which slot each effect() call was made inside. 'effect' on its own says a thing was registered
  // under an effect, not which page it leaves behind when it is not.
  const open = []
  const layers = []
  const ctx = {
    slots: {
      inject(name, fn) {
        seen.push(['inject', name])
        open.push(name)
        fn()
        open.pop()
      },
      register(owner, comp) {
        seen.push(['register', owner.name, owner.id, owner.key, owner.label])
        components.push({ owner, comp })
        return () => undefined
      },
    },
    effect(fn) {
      seen.push(['effect'])
      layers.push(open.length === 0 ? 'effect' : open[open.length - 1] + '/effect')
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
  return { plugin, seen, componentOf, layers }
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

test('the settings page is claimed under that same id, and can be closed again', () => {
  // Settings' list slot keys pages by id and reads the id back as the nav label. A page registered
  // under a second id would be a second entry in Settings pointing at the same component.
  const { seen, layers } = orderOf(fakeReact)
  const at = seen.findIndex((row) => row[0] === 'inject' && row[1] === 'settings.section')
  assert.ok(at >= 0, 'nothing was injected into settings.section')
  const settingsRow = seen.slice(at).find((row) => row[0] === 'register' && row[1] === 'settings.section')
  assert.ok(settingsRow)
  assert.equal(settingsRow[2], 'dsh-multipool')
  assert.equal(settingsRow[4], 'DSH Multipool')
  // Registered through an effect of its own, so a disable takes it back out instead of leaving a
  // ghost page in Settings for the rest of the session.
  assert.ok(layers.includes('settings.section/effect'))
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
  assert.ok(lines[1].includes('\u8d26\u53f7\u6c60'))
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

test('the test button presses the test endpoint, not the command one', async () => {
  // Boundary. 'test is not a write' was a true sentence printed by the wrong door: the page was
  // posting { name: 'test' } to /command, the command table rightly refused a word that is not a
  // command, and the refusal looked like the button working. A test reaches an upstream, so it has
  // its own endpoint -- and an install with no credential service must still be able to answer it.
  const page = recordingPage(envelopeHost(() => ({ said: 'HTTP 401: Login required', usage: null })))
  const plugin = factory(page)
  const said = await plugin.testOf()
  assert.equal(page.calls.length, 1)
  assert.equal(page.calls[0][0], '/dsh-multipool/test')
  // undefined body: not an object, not even an empty one. The host reads a provider id out of
  // whatever arrives, and {} would look like a payload that named nobody.
  assert.equal(page.calls[0][1].body, "null")
  assert.equal(said, 'HTTP 401: Login required')
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


test('paints what the host computed instead of computing it again', () => {
  // The host's answer is { view, reading } where view is already an IconView. An earlier version
  // handed that IconView to iconViewOf() as a Snapshot, which reads snapshot.overall.available --
  // so it threw, ask() turned the throw into a refusal envelope, and the rail painted the
  // placeholder for ever while the wire was saying green. Only a host that answers with a real
  // reading can catch that: every other test in this file stops before the wrapper is read.
  const answered = {
    level: 'green',
    counts: { available: 1, total: 1, reading: 'read' },
    badge: '1/1',
    attached: true,
    lines: { accounts: 'a', rpm: 'r', points: 'p' },
  }
  const page = recordingPage(envelopeHost(() => ({ view: answered, reading: 'read' })))
  const plugin = factory(page)
  return plugin.viewOf().then((view) => {
    assert.equal(view.level, 'green')
    assert.equal(view.badge, '1/1')
    assert.deepEqual(view.lines, answered.lines)
  })
})
test('a reading is printed in two decimals, under a sentence that does not deny it', () => {
  // What the real host answered on 2026-11-27: the full float, because JSON carries the float its
  // parser built. The page had printed all of it beside a sentence saying no number came back.
  const plugin = factory()
  const answered = plugin.sentenceOf({
    providerId: 'amd',
    said: '',
    atMs: 1,
    tooSoon: false,
    usage: {
      available: true,
      rpmLimit: { value: 20, source: 'api' },
      dailyLimitPts: { value: 1, source: 'api' },
      dailyUsedPts: { value: 0.19718791934428737, source: 'api' },
      dailyRemainingPts: { value: 0.8028120806557127, source: 'api' },
      fetchedAt: '2026-11-27T04:06:00Z',
    },
  })
  assert.match(answered, /0\.2 \/ 1 pts/)
  assert.doesNotMatch(answered, /0\.19718791934428737/)
  assert.doesNotMatch(answered, /\u2014/)
})

test('a whole number does not grow decimals it did not need', () => {
  const plugin = factory()
  const answered = plugin.sentenceOf({
    providerId: 'amd',
    said: '',
    atMs: 1,
    tooSoon: false,
    usage: {
      available: true,
      dailyLimitPts: { value: 20, source: 'api' },
      dailyUsedPts: { value: 5, source: 'api' },
      fetchedAt: '2026-11-27T04:06:00Z',
    },
  })
  assert.match(answered, /5 \/ 20 pts/)
})

test('a reading leads with its own sentence, not with the one for a missing number', () => {
  const plugin = factory()
  const answered = plugin.sentenceOf({
    providerId: 'amd',
    said: '',
    atMs: 1,
    tooSoon: false,
    usage: { available: true, dailyLimitPts: { value: 1, source: 'api' }, dailyUsedPts: { value: 0.2, source: 'api' } },
  })
  // The left half of "0.2 / 1 pts" used to be the refusal sentence, so the line denied the number it
  // printed. Nothing above checked the opening words; this does.
  assert.match(answered, /\u4e0a\u6e38\u56de\u7b54\uff1a 0\.2 \/ 1 pts/)
  assert.doesNotMatch(answered, /\u6ca1\u5e26\u56de\u7528\u91cf\u6570\u5b57/)
})

test('the reading line carries no word about where the key is kept', () => {
  const plugin = factory()
  const reading = { available: true, dailyLimitPts: { value: 1, source: 'api' }, dailyUsedPts: { value: 0.59, source: 'api' } }
  // Handing the attempt a layer is the case that tempted the append: the reading already knows
  // enough to say where the key is, so it says it right after the number. Two facts, one line,
  // and the result reads as a fact about the number.
  const named = plugin.sentenceOf({ providerId: 'amd', said: '', atMs: 1, tooSoon: false, layer: 'file', usage: reading })
  assert.equal(named, '\u4e0a\u6e38\u56de\u7b54\uff1a 0.59 / 1 pts')
  assert.doesNotMatch(named, /\u914d\u7f6e\u6587\u4ef6/)
})

test('a key with no reported layer is called present, not called any particular place', () => {
  const plugin = factory()
  // The host said there is a key, and stopped there. Finishing its sentence for it -- "survives
  // the terminal", "in the config file" -- is this page asserting what it was never told, so it
  // asserts the one word it received.
  assert.equal(
    plugin.whereOf({ reading: 'read', present: true, layer: undefined }),
    '\u5df2\u5b58\u5728\u672c\u673a',
  )
  // And a layer the host did name is repeated, not translated into a guess.
  assert.equal(
    plugin.whereOf({ reading: 'read', present: true, layer: 'file' }),
    '\u5df2\u5b58\u5728\u672c\u673a\uff08\u914d\u7f6e\u6587\u4ef6\uff09',
  )
  // An unread section says it has not looked, which is a different sentence from "not there".
  assert.equal(
    plugin.whereOf({ reading: 'unread', present: false, layer: undefined }),
    '\u672c\u673a\u8fd8\u6ca1\u8bfb\u8fc7',
  )
  // A layer this page has no word for is not a bracket holding its own ignorance: the sentence
  // before the bracket is still true and still useful.
  assert.equal(
    plugin.whereOf({ reading: 'read', present: true, layer: 'a-layer-from-the-future' }),
    '\u5df2\u5b58\u5728\u672c\u673a',
  )
})

test('a page with no window at all is a host too old, not a save that failed', async () => {
  const plugin = factory({ __ModuleLoader__: globalThis.window.__ModuleLoader__ })
  const outcome = await plugin.commandOf({ name: 'save', key: 'rc-abc' })
  assert.equal(outcome.ok, false)
  // One word for both ways of not reaching a host: a page has one action to offer either way.
  assert.equal(outcome.reason, 'command failed')
})
