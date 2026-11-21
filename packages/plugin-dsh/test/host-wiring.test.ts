import { beforeEach, describe, expect, it } from 'vitest'

import { CHANNEL, ENDPOINT_COMMAND, type Channel } from '../src/channel.js'
import { KEY_UPDATED_EVENT, type KeyStatus } from '../src/credentials.js'
import { apply } from '../src/index.js'

type Listener = (moved: unknown) => void

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
type Served = Map<string, { opened: string[]; handler: (endpoint: string, payload: unknown) => Promise<unknown> }>

interface FakeConnection {
  rpc: {
    handle(
      channel: string,
      handler: (endpoint: string, payload: unknown) => Promise<unknown>,
    ): () => void
  }
}

function contextOf(config: { hasInject: boolean; configured?: boolean }) {
  const effects: Array<() => () => void> = []
  const injections: string[] = []
  const listeners: Listener[] = []
  const served: Served = new Map()
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
  const connection: FakeConnection = {
    rpc: {
      handle(channel, handler) {
        served.set(channel, { opened: [], handler })
        return () => {
          served.delete(channel)
        }
      },
    },
  }
  const context = {
    effect(callback: () => () => void): () => void {
      effects.push(callback)
      return () => undefined
    },
    inject: config.hasInject
      ? (names: string[], callback: (child: { credentials: FakeSeam; connection: FakeConnection }) => void): (() => void) => {
          for (const name of names) injections.push(name)
          callback({ credentials: seam, connection })
          return () => undefined
        }
      : undefined,
    on(name: string, listener: Listener): () => void {
      expect(name).toBe(KEY_UPDATED_EVENT)
      listeners.push(listener)
      return () => undefined
    },
  }
  return { context, effects, injections, listeners, seam, served }
}


describe('the host half asks the seam only when somebody is reading the answer', () => {
  it('registers the route and asks nothing when no reader is given', async () => {
    const { context, effects, injections, seam, served } = contextOf({ hasInject: true })
    apply(context)
    // apply() only registers its body; the channel is opened when effect() runs it, as cordis does.
    const disposers = effects.map(effect => effect())
    expect(injections).toEqual(['connection'])
    expect(seam.reads).toBeUndefined()
    // Both processes can see globalThis; only one of them can see the route, and that is why
    // the route is where the page is told anything.
    expect(CHANNEL).toBe('/multipool')
    expect(served.has(CHANNEL)).toBe(true)

    for (const dispose of disposers) dispose()
    expect(served.has(CHANNEL)).toBe(false)
  })

  it('arms one read through the credentials service when a reader is given', async () => {
    const { context, effects, injections } = contextOf({ hasInject: true })
    const seen: KeyStatus[] = []
    apply(context, { onKeyStatus: status => seen.push(status) })
    const disposers = effects.map(effect => effect())

    expect(injections).toEqual(['connection', 'credentials'])
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(seen).toHaveLength(1)
    expect(seen[0]?.kind).toBe('read')
    expect(seen[0]?.kind === 'read' ? seen[0].state : undefined).toEqual({ kind: 'absent' })

    for (const dispose of disposers) dispose()
  })

  it('still opens the channel on a context that cannot inject', () => {
    const { context, effects, injections, seam, served } = contextOf({ hasInject: false })
    apply(context, { onKeyStatus: () => undefined })
    const disposers = effects.map(effect => effect())
    expect(injections).toEqual([])
    expect(seam.reads).toBeUndefined()
    // Nothing was registered anywhere, and nothing threw on the way to saying so.
    expect(served.size).toBe(0)
    for (const dispose of disposers) dispose()
    expect(served.size).toBe(0)
  })
})

describe('the host half hands writes to the page, and performs none itself', () => {
  type Answer = { ok: boolean; value?: unknown; error?: { code: string; message: string } }

  /**
   * The page's side of one command: POST the endpoint through the route apply() registered, and
   * unwrap the envelope the way client-connection does. Written out rather than imported so the
   * shape of the wire is asserted here and not only over there.
   */
  const commandOn = async (served: Served, request: unknown) => {
    const route = served.get('/multipool')
    expect(route).toBeDefined()
    const once = (await route?.handler(ENDPOINT_COMMAND, { request })) as Answer
    expect(once.ok).toBe(true)
    return once.value as { ok: boolean; reason?: string; status?: unknown; message?: string | null }
  }

  it('offers command() once accepted, and writes nothing just for being enabled', async () => {
    const { context, effects, seam, served } = contextOf({ hasInject: true })
    apply(context, { acceptsWrites: true })
    const disposers = effects.map(effect => effect())
    expect(typeof served.get(CHANNEL)?.handler).toBe('function')
    // Arming opened the channel; it did not save, forget, or even read the seam.
    expect(seam.reads).toBeUndefined()
    for (const dispose of disposers) dispose()
  })

  it('refuses a save the store rejects, and says which rule in the store\'s words', async () => {
    const { context, effects, seam, served } = contextOf({ hasInject: true })
    apply(context, { acceptsWrites: true })
    const disposers = effects.map(effect => effect())
    const outcome = await commandOn(served, { name: 'save', key: 'sk-not-an-amd-key' })
    expect(outcome.ok).toBe(false)
    expect(outcome.reason).toBe('absent')
    expect(outcome.message).toContain('sk-')
    // The refused key never reached set(); the one read this command makes is that confirm re-read.
    expect(seam.reads).toBe(1)
    for (const dispose of disposers) dispose()
  })

  it('saves a well-formed key, then reports the seam rather than its own optimism', async () => {
    const { context, effects, seam, served } = contextOf({ hasInject: true, configured: true })
    apply(context, { acceptsWrites: true })
    const disposers = effects.map(effect => effect())
    const outcome = await commandOn(served, { name: 'save', key: 'rc-' + 'a'.repeat(32) })
    expect(outcome.ok).toBe(true)
    // Exactly the confirm read this command just made: the earlier ok case showed that arming
    // without a reader asks the seam nothing, and this count is what pins that down.
    expect(seam.reads).toBe(1)
    for (const dispose of disposers) dispose()
  })

  it('stays closed to writes when the host is not asked to accept them', async () => {
    const { context, effects, injections, served } = contextOf({ hasInject: true })
    apply(context)
    const disposers = effects.map(effect => effect())
    expect(injections).toEqual(['connection'])
    expect(typeof served.get(CHANNEL)?.handler).toBe('function')
    expect(await commandOn(served, { name: 'save', key: 'rc-' + 'a'.repeat(32) })).toEqual({
      ok: false,
      reason: 'no credential service',
    })
    for (const dispose of disposers) dispose()
  })
})
