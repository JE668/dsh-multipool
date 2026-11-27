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
import { KEY_UPDATED_EVENT, type KeyStatus } from '../src/credentials.js'
import { apply } from '../src/index.js'

type Listener = (moved: unknown) => void

/** The em dash the icon paints when it has no count, written as an escape so this file is ASCII. */
const NO_VALUE_BADGE = '\u2014/\u2014'

interface FakeSeam {
  resolve(ref: string): Promise<undefined>
  describe(ref: string): Promise<{ configured: boolean; source?: string; writable: boolean; masked?: string }>
  set(ref: string, value: string): Promise<void>
  unset(ref: string): Promise<void>
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
    resolve: async () => undefined,
    describe: async () => {
      seam.reads = (seam.reads ?? 0) + 1
      return config.configured === true
        ? { configured: true, source: 'file', writable: true, masked: 'rc-\u2022\u2022' }
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
    // This install has a seam and nothing to ask through it, so the host answers with a sentence
    // rather than a refusal: readAmdUsage() says "this credential service cannot make requests"
    // and the attempt travels back under ok: true. That is the whole assertion --
    // the route reached a source. The first draft of this test expected ok:false and the code
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
    expect((answered.value?.said ?? '') as string).not.toBe('')
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

  it('stays closed to writes when the host is not asked to accept them', async () => {
    const { context, effects, injections } = contextOf({ hasInject: true })
    const server = new FakeServer()
    apply(context, { server })
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

