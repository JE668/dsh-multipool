import { beforeEach, describe, expect, it } from 'vitest'

import {
  CHANNEL,
  ENDPOINT_COMMAND,
  ENDPOINT_SNAPSHOT,
  ENDPOINT_TEST,
  NO_TEST_SOURCE,
  type BridgeRequest,
  type BridgeResponse,
  type Channel,
  type Route,
  type RouteServer,
} from '../src/channel.js'
import { AMD_KEY_REF, KEY_UPDATED_EVENT, type KeyStatus } from '../src/credentials.js'
import { apply } from '../src/index.js'

type Listener = (moved: unknown) => void

/** Answer one fetch without a socket, and keep the cast to the global out of every test. */
function pretendFetch(impl: (url: unknown, init: unknown) => Promise<unknown>): void {
  globalThis.fetch = impl as typeof globalThis.fetch
}

/** The em dash the icon paints when it has no count, written as an escape so this file is ASCII. */
const NO_VALUE_BADGE = '\u2014/\u2014'

interface FakeSeam {
  /** Stubbed per test: the container answers undefined, a test may make it answer a value. */
  resolve(ref: string): Promise<{ readonly value: string; readonly source?: string } | undefined>
  describe(ref: string): Promise<{ configured: boolean; source?: string; writable: boolean; masked?: string }>
  set(ref: string, value: string): Promise<void>
  unset(ref: string): Promise<void>
  /** What the store last resolved, when a test needs describe() to follow resolve(): the two are
   *  one seam answering two questions; and the test should not have to keep them in step by
   *  hand. Absent means "describe() does not follow the last resolve()", which is the default. */
  layer?: string
  reads?: number
}

/**
 * A context carrying only what apply() reads, recorded instead of performed.
 * `hasInject: false` stands for a context that predates the inject mixin.
 */
/**
 * The web server, as far as this plugin can tell one apart: it keeps routes and drops them again.
 *
 * Not a listening socket. All a caller needs to know here is whether the route was claimed and what
 * the route says -- so `ask` builds the two Node objects the handler reads and returns the answer
 * already parsed. A real server is only ever asked those two questions by a page.
 */
class FakeServer implements RouteServer {
  readonly routes = new Map<string, Route>()
  readonly taken: Array<{ readonly status: number | undefined; readonly headers: unknown; readonly body: string | undefined }> = []

  register(route: Route): () => void {
    expect(route.kind).toBe('prefix')
    this.routes.set(route.path, route)
    return () => {
      this.routes.delete(route.path)
    }
  }

  /** What the page does: one POST, and whatever came back -- parsed when it is JSON. */
  async ask(endpoint: string, payload: unknown, method = 'POST'): Promise<unknown> {
    const route = this.routes.get(CHANNEL)
    if (route === undefined) return undefined
    const body = payload === undefined ? '' : JSON.stringify(payload)
    const req: BridgeRequest = {
      method,
      url: CHANNEL + '/' + endpoint,
      [Symbol.asyncIterator]: async function* () {
        if (body !== '') yield Buffer.from(body)
      },
    }
    let status: number | undefined
    let headers: unknown = undefined
    let written: string | undefined
    const res: BridgeResponse = {
      writeHead(next: number, given?: unknown) {
        status = next
        headers = given
      },
      end(done?: string) {
        written = done
      },
    }
    await route.handler(req, res)
    this.taken.push({ status, headers, body: written })
    if (status !== 200) return undefined
    return written === undefined ? undefined : JSON.parse(written)
  }
}



function contextOf(config: { hasInject: boolean; configured?: boolean; missing?: 'webServer' }) {
  const effects: Array<() => () => void> = []
  const injections: string[] = []
  const listeners: Listener[] = []
  const seam: FakeSeam = {
    // Appended per test: the container default has no resolve, and readAmdUsage() would now see a
    // seam that cannot hand over a value -- which is a different sentence than "no seam at all".
    resolve: async () => undefined,
    describe: async () => {
      seam.reads = (seam.reads ?? 0) + 1
      return config.configured === true
        ? { configured: true, source: seam.layer ?? 'file', writable: true, masked: 'rc-\u2022\u2022' }
        : { configured: false, writable: true }
    },
    set: async () => undefined,
    unset: async () => undefined,
  }
  const server = new FakeServer()
  const context = {
    effect(callback: () => () => void): () => void {
      effects.push(callback)
      return () => undefined
    },
    inject: config.hasInject
      ? (names: string[], callback: (child: { credentials?: FakeSeam; webServer?: RouteServer }) => void): (() => void) => {
          for (const name of names) injections.push(name)
          callback(config.missing === 'webServer'
            ? { credentials: seam }
            : { credentials: seam, webServer: server })
          return () => undefined
        }
      : undefined,
    on(name: string, listener: Listener): () => void {
      expect(name).toBe(KEY_UPDATED_EVENT)
      listeners.push(listener)
      return () => undefined
    },
  }
  return { context, effects, injections, listeners, seam, server }
}


describe('the host half asks the seam only when somebody is reading the answer', () => {
  it('reads the seam once even with no reader, because the icon always paints a reading', async () => {
    const { context, effects, injections, seam, server } = contextOf({ hasInject: true })
    apply(context, { server })
    // apply() only registers its body; the channel is opened when effect() runs it, as cordis does.
    const disposers = effects.map(effect => effect())
    expect(injections).toEqual(['credentials'])
    expect(seam.reads).toBe(1)
    // One injection installs the watch, and watchKeyStatus() reads once on its way in: that read is
    // how the icon tells an empty pool from a pool nobody has looked at.
    expect(CHANNEL).toBe('/dsh-multipool')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(server.routes.has(CHANNEL)).toBe(true)
    const answered = (await server.ask(ENDPOINT_SNAPSHOT, undefined)) as {
      value: { view: { badge: string }; reading: string }
    }
    expect(answered.value.reading).toBe('empty')
    expect(answered.value.view.badge).toBe('0/0')
    for (const dispose of disposers) dispose()
    expect(server.routes.has(CHANNEL)).toBe(false)
  })

  it('hands the reader the same read it makes for the icon, not a second one', async () => {
    const { context, effects, injections, seam } = contextOf({ hasInject: true })
    const server = new FakeServer()
    const seen: KeyStatus[] = []
    apply(context, { server, onKeyStatus: status => seen.push(status) })
    const disposers = effects.map(effect => effect())

    expect(injections).toEqual(['credentials'])
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(seen).toHaveLength(1)
    // Reading is all that happened: the seam wrote nothing, and the route answers anyway.
    expect(seam.reads).toBe(1)
    expect(server.routes.has(CHANNEL)).toBe(true)

    for (const dispose of disposers) dispose()
  })

  it('activates when a service the host wanted is absent from this DSH', async () => {
    // The shape a real install took: the context had no webServer to hand back, and the code that
    // read the missing one threw on the read. A dashed icon is still an icon; a throw is nothing at
    // all, and the user sees the plugin leave the rail (docs/09 section 6.1).
    const { context, effects, injections } = contextOf({ hasInject: true, missing: 'webServer' })
    expect(() => apply(context, { onKeyStatus: () => undefined })).not.toThrow()
    const disposers = effects.map(effect => effect())
    // the half that was there still arms. Only the automatic claim is lost, and only until a server
    // is handed in, which is the difference between a dashed icon and no icon at all.
    expect(injections).toEqual(['webServer', 'credentials'])
    // One effect body, run once: the route claim and the credential watch both live inside it.
    expect(effects).toHaveLength(1)
    expect(() => {
      for (const dispose of disposers) dispose()
    }).not.toThrow()
  })

  it('claims the route when a server is handed in, and answers through it', async () => {
    const { context, effects, server } = contextOf({ hasInject: true })
    apply(context, { server, onKeyStatus: () => undefined })
    const disposers = effects.map(effect => effect())
    // The route passed in still answers: the automatic claim is the convenience, not the channel.
    expect(server.routes.has(CHANNEL)).toBe(true)
    expect(() => {
      for (const dispose of disposers) dispose()
    }).not.toThrow()
    expect(server.routes.has(CHANNEL)).toBe(false)
  })

  it('still opens the channel on a context that cannot inject', async () => {
    const { context, effects, injections, seam } = contextOf({ hasInject: false })
    const server = new FakeServer()
    apply(context, { server, onKeyStatus: () => undefined })
    const disposers = effects.map(effect => effect())
    // Nobody could be asked, and nothing threw on the way to saying so.
    expect(injections).toEqual([])
    expect(seam.reads).toBeUndefined()
    // The route is there all the same: it is a plain object handed in, and no context refuses one.
    expect(server.routes.has(CHANNEL)).toBe(true)
    const answered = (await server.ask(ENDPOINT_SNAPSHOT, undefined)) as {
      ok: boolean
      value: { view: { badge: string; level: string }; reading: string }
    }
    expect(answered.ok).toBe(true)
    // The pool was never counted, so the badge must not say 0/0: dashes and an idle ring.
    expect(answered.value.reading).toBe('unread')
    expect(answered.value.view.badge).toBe(NO_VALUE_BADGE)
    expect(answered.value.view.level).toBe('idle')
    for (const dispose of disposers) dispose()
  })
})

describe('the route is claimed where it is asked, and only for a POST', () => {
  it('claims on effect(), not on apply(), and gives the prefix back on dispose', () => {
    // apply() only registers its body -- cordis runs it. A route claimed here would also outlive the
    // disable that never ran the body, and this test would pass while the plugin leaked one prefix
    // per load, which the web server throws on rather than forgets.
    const { context, effects } = contextOf({ hasInject: false })
    const server = new FakeServer()
    const dispose = apply(context, { server })
    expect(server.routes.size).toBe(0)
    const disposers = effects.map((effect) => effect())
    expect(server.routes.has(CHANNEL)).toBe(true)
    for (const one of disposers) one()
    expect(server.routes.has(CHANNEL)).toBe(false)
    dispose()
  })

  it('opens without a server at all, and claims nothing', () => {
    // A host process with no web server: the shape apply() survives, because an entry that throws is
    // removed from the page entirely and leaves only a console line (docs/09 section 6.1).
    const { context, effects } = contextOf({ hasInject: false })
    expect(() => apply(context)).not.toThrow()
    const disposers = effects.map((effect) => effect())
    expect(() => {
      for (const one of disposers) one()
    }).not.toThrow()
  })

  it('does not fall back to globalThis, which is a different object from the page', () => {
    // No service, no server: no route. The page finds nothing and draws dashes, which is the truth --
    // a route claimed on an object nobody serves would be a careful-looking silence.
    const { context, effects } = contextOf({ hasInject: false })
    expect(() => apply(context, { onKeyStatus: () => undefined })).not.toThrow()
    for (const effect of effects) effect()()
    expect((globalThis as { readonly addEventListener?: unknown }).addEventListener).toBeUndefined()
  })

  it('answers a GET with 405 and Allow, instead of a snapshot a cache could keep', async () => {
    const { context, effects } = contextOf({ hasInject: false })
    const server = new FakeServer()
    apply(context, { server })
    const disposers = effects.map((effect) => effect())
    const answered = await server.ask(ENDPOINT_SNAPSHOT, undefined, 'GET')
    expect(answered).toBeUndefined()
    expect(server.taken.at(-1)?.status).toBe(405)
    expect(server.taken.at(-1)?.headers).toEqual({
      allow: 'POST',
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    })
    // HEAD is the same answer with the body left off, for whoever is only checking reachability.
    const head = await server.ask(ENDPOINT_SNAPSHOT, undefined, 'HEAD')
    expect(head).toBeUndefined()
    expect(server.taken.at(-1)?.status).toBe(405)
    expect(server.taken.at(-1)?.body).toBeUndefined()
    for (const dispose of disposers) dispose()
  })

  it('names a path it does not have, rather than running the endpoint it resembles', async () => {
    const { context, effects } = contextOf({ hasInject: false })
    const server = new FakeServer()
    apply(context, { server, acceptsWrites: true })
    const disposers = effects.map((effect) => effect())
    // Not a name this file knows, and carrying a command that would have been obeyed if it were
    // dispatched by shape alone.
    const answered = await server.ask('save', { request: { name: 'save', key: 'rc-' + 'a'.repeat(32) } })
    expect(answered).toEqual({
      ok: false,
      error: { code: 'multipool/unknown-endpoint', message: 'no endpoint "save"' },
    })
    for (const dispose of disposers) dispose()
  })

  it('refuses a body that is not JSON, and says so in its own words', async () => {
    const { context, effects } = contextOf({ hasInject: false })
    const server = new FakeServer()
    apply(context, { server })
    const disposers = effects.map((effect) => effect())
    const route = server.routes.get(CHANNEL)
    let status: number | undefined
    let written: string | undefined
    const req: BridgeRequest = {
      method: 'POST',
      url: CHANNEL + '/' + ENDPOINT_COMMAND,
      [Symbol.asyncIterator]: async function* () {
        yield Buffer.from('{not json')
      },
    }
    const res: BridgeResponse = {
      writeHead(next: number) {
        status = next
      },
      end(done?: string) {
        written = done
      },
    }
    await route?.handler(req, res)
    expect(status).toBe(400)
    expect(written).toBe('request body is not JSON' + String.fromCharCode(10))
    for (const dispose of disposers) dispose()
  })
})

// The gap this guards: apply() built a source, openChannel() kept it alive only for the icon, and
// serveOn() was called with two arguments -- so the route existed with no source behind it, the test
// endpoint refused every press, and every unit test stayed green, because a test passes the source
// itself. A test that hands in what production forgets cannot watch production forget it, so this one
// goes the whole way: apply() -> a route the page can reach -> the test endpoint.
describe('the route the page actually reaches', () => {
  it('answers the test endpoint with a source, because apply() hands one to the route', async () => {
    const { context, effects, server } = contextOf({ hasInject: true })
    apply(context, { server })
    for (const effect of effects) effect()
    // This install has a seam and nothing stored for it, so the host answers with a sentence
    // rather than a refusal -- "no AMD_API_KEY is stored, so there was nothing to send" -- and the
    // attempt travels back under ok: true. That is the whole assertion: the route reached a source. The first draft of this test expected ok:false and the code
    // NO_TEST_SEAM, which is the shape of the bug, not of the fix: it went red the first time it
    // ran and the temptation was to un-wire testUsage to make it green. The red was the test.
    const answered = (await server.ask(ENDPOINT_TEST, undefined)) as {
      ok: boolean
      value?: { said?: string; usage?: unknown }
      error?: { code: string }
    }

    expect(answered.error).toBeUndefined()
    expect(answered.ok).toBe(true)
    expect(typeof answered.value?.said).toBe('string')
    // Non-empty: the host did not merely have a source, it asked it and got a sentence back.
    // The container's resolve() answers undefined, so the sentence is the absent-key one -- not
    // the "cannot make requests" one that used to stand for every failure at once.
    expect(answered.value?.said).toBe(
      'upstream unreachable: no AMD_API_KEY is stored, so there was nothing to send',
    )
  })

  it('sends the key the seam resolved, and says nothing about it afterwards', async () => {
    // The seam is what the plugin cannot fake: resolve() is the only way the value gets here. So the
    // seam is stubbed at that one member and the request itself is watched at globalThis.fetch --
    // anything the plugin invented would show up on the wrong side of that boundary.
    const { context, effects, listeners, seam } = contextOf({ hasInject: true, configured: true })
    const server = new FakeServer()
    // A clock this test owns: the minute between two presses is a fact about wall time, not
    // about what is being tested. Moving it forward is the same door the host uses -- there is no
    // reset hook here, and a test that needed one would be testing a path production cannot run.
    let now = 1_800_000_000_000
    const realNow = Date.now
    Date.now = () => now
    seam.resolve = async () => ({ value: 'rc-a-key-from-the-store', source: 'file' })
    const realFetch = globalThis.fetch
    const frames: Array<{ url: string; init: { method: string; headers: Record<string, string> } }> = []
    pretendFetch(async (url, init) => {
      var seen = init as { method: string; headers: Record<string, string> }
      frames.push({ url: String(url), init: seen })
      return {
        status: 200,
        text: async () => JSON.stringify({ daily_cost_limit_usd: 1, daily_cost_used_usd: 0.5 }),
      }
    })
    try {
      apply(context, { server })
      for (const effect of effects) effect()
      const answered = (await server.ask(ENDPOINT_TEST, undefined)) as {
        value: {
          said: string
          layer?: string
          usage: { dailyUsedPts: { value: number } } | null
        }
      }
      expect(frames).toHaveLength(1)
      expect(frames[0]?.init.method).toBe('GET')
      expect(frames[0]?.init.headers.authorization).toBe('Bearer rc-a-key-from-the-store')
      expect(frames[0]?.url).toContain('/usage?include_recent=true')
      expect(answered.value.usage?.dailyUsedPts.value).toBe(0.5)
      // Nothing on the way back out repeats the key: not the sentence, not the reading.
      expect(JSON.stringify(answered)).not.toContain('rc-a-key-from-the-store')
      // The layer the key lives in rides on the reading, so the form can name it without a second
      // request.
      expect(answered.value.layer).toBe('file')
      // Moving the clock is what makes the second press a second question at all: inside the minute
      // the floor answers with the first reading and asks upstream nothing.
      // The layer above is not cached from the first press: it is re-read when a reading goes out,
      // because inside the minute there is no new reading for a new layer to sit beside, and outside
      // it the store is the only thing that can say which name it now holds. So the test swaps the
      // store between the two presses rather than raising an event -- there is no listener to raise
      // it at yet, since apply()'s injection callback runs after the effect that asked for it, and
      // the watch is installed there, not inside openChannel().
      now += 60_001
      seam.resolve = async () => ({ value: 'rc-a-key-from-the-store', source: 'env' })
      seam.layer = 'env'
      const named = (await server.ask(ENDPOINT_TEST, undefined)) as {
        value: { said: string; layer?: string; usage: unknown }
      }
      expect(named.value.layer).toBe('env')
      // A reading is a complete answer: `said` is for the cases where the number is missing, and an
      // empty string here is what lets the page print its own "upstream answered: <used> / <limit>"
      // instead of a sentence that contradicts the number sitting beside it.
      expect(named.value.said).toBe('')
      // And the seam still holds the only copy.
      expect(JSON.stringify(named)).not.toContain('rc-a-key-from-the-store')
    } finally {
      globalThis.fetch = realFetch
      Date.now = realNow
    }
  })

  it('says the key is missing when the seam has nothing stored, instead of blaming the wire', async () => {
    const { context, effects } = contextOf({ hasInject: true })
    const server = new FakeServer()
    let asked = 0
    const realFetch = globalThis.fetch
    pretendFetch(async () => {
      asked += 1
      return { status: 200, text: async () => '{}' }
    })
    try {
      apply(context, { server })
      for (const effect of effects) effect()
      const answered = (await server.ask(ENDPOINT_TEST, undefined)) as { value: { said: string; usage: unknown } }
      expect(asked).toBe(0)
      expect(answered.value.usage).toBeNull()
      expect(answered.value.said).toBe(
        'upstream unreachable: no AMD_API_KEY is stored, so there was nothing to send',
      )
    } finally {
      globalThis.fetch = realFetch
    }
  })

  it('carries the last reading when pressed again inside the minute', async () => {
    const { context, effects, seam } = contextOf({ hasInject: true })
    const server = new FakeServer()
    seam.resolve = async () => ({ value: 'rc-a-key-from-the-store', source: 'file' })
    const realFetch = globalThis.fetch
    let asked = 0
    pretendFetch(async () => {
      asked += 1
      return {
        status: 200,
        text: async () => JSON.stringify({ daily_cost_limit_usd: 1, daily_cost_used_usd: 0.5 }),
      }
    })
    try {
      apply(context, { server })
      for (const effect of effects) effect()
      const first = (await server.ask(ENDPOINT_TEST, undefined)) as {
        value: { said: string; tooSoon: boolean; carried?: boolean; usage: { dailyUsedPts: { value: number } } | null }
      }
      const second = (await server.ask(ENDPOINT_TEST, undefined)) as typeof first
      expect(asked).toBe(1)
      expect(first.value.tooSoon).toBe(false)
      expect(first.value.carried).toBeUndefined()
      expect(second.value.usage?.dailyUsedPts.value).toBe(0.5)
      // One request, one number on screen twice -- and the second press says which one it is.
      expect(second.value.carried).toBe(true)
      expect(second.value.said).not.toBe(first.value.said)
      expect(second.value.said).not.toBe('')
    } finally {
      globalThis.fetch = realFetch
    }
  })
})

describe('the host half hands writes to the page, and performs none itself', () => {
  type Outcome = {
    ok: boolean
    reason?: string
    status?: unknown
    message?: string | null
  }

  /** The page's side of one command: POST the endpoint, and unwrap the envelope it got back. */
  const commandOn = async (server: FakeServer, request: unknown) => {
    const answered = (await server.ask(ENDPOINT_COMMAND, { request })) as {
      ok: boolean
      value: Outcome
    }
    expect(answered.ok).toBe(true)
    return answered.value
  }

  it('offers command() once accepted, and writes nothing just for being enabled', async () => {
    const { context, effects, seam } = contextOf({ hasInject: true })
    const server = new FakeServer()
    apply(context, { server, acceptsWrites: true })
    const disposers = effects.map(effect => effect())
    expect(typeof server.routes.get(CHANNEL)?.handler).toBe('function')
    // Arming opened the channel and read the seam once: it saved nothing and forgot nothing.
    expect(seam.reads).toBe(1)
    for (const dispose of disposers) dispose()
  })

  it('refuses a save the store rejects, and says which rule in the store words', async () => {
    const { context, effects, seam } = contextOf({ hasInject: true })
    const server = new FakeServer()
    apply(context, { server, acceptsWrites: true })
    const disposers = effects.map(effect => effect())
    const outcome = await commandOn(server, { name: 'save', key: 'sk-not-an-amd-key' })
    expect(outcome.ok).toBe(false)
    expect(outcome.reason).toBe('absent')
    expect(outcome.message).toContain('sk-')
    // The refused key never reached set(); the one read this command makes is that confirm re-read.
    expect(seam.reads).toBe(2)
    for (const dispose of disposers) dispose()
  })

  it('saves a well-formed key, then reports the seam rather than its own optimism', async () => {
    const { context, effects, seam } = contextOf({ hasInject: true, configured: true })
    const server = new FakeServer()
    apply(context, { server, acceptsWrites: true })
    const disposers = effects.map(effect => effect())
    const outcome = await commandOn(server, { name: 'save', key: 'rc-' + 'a'.repeat(32) })
    expect(outcome.ok).toBe(true)
    // Exactly the confirm read this command just made: the earlier ok case showed that arming
    // without a reader asks the seam nothing, and this count is what pins that down.
    expect(seam.reads).toBe(2)
    for (const dispose of disposers) dispose()
  })

  it('stays closed to writes when the embedder says so, though the default is open', async () => {
    const { context, effects, injections } = contextOf({ hasInject: true })
    const server = new FakeServer()
    apply(context, { server, acceptsWrites: false })
    const disposers = effects.map(effect => effect())
    expect(injections).toEqual(['credentials'])
    expect(typeof server.routes.get(CHANNEL)?.handler).toBe('function')
    expect(await commandOn(server, { name: 'save', key: 'rc-' + 'a'.repeat(32) })).toEqual({
      ok: false,
      reason: 'no credential service',
    })
    for (const dispose of disposers) dispose()
  })
})

