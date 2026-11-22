import { beforeEach, describe, expect, it } from 'vitest'

import {
  BRIDGE_EVENT,
  BRIDGE_REPLY,
  ENDPOINT_COMMAND,
  type BridgeTarget,
  type Channel,
} from '../src/channel.js'
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
/**
 * A window that records who listens on it and lets a test dispatch as the page would.
 *
 * One shared object, because that is the point of the bridge: the host adds a listener() to it and
 * the page dispatches on the same bus. `delivered` is whatever the host sent back.
 */
class FakeWindow implements BridgeTarget {
  readonly listening = new Map<string, Array<(event: unknown) => void>>()
  readonly delivered: Array<{ readonly type: string; readonly detail?: unknown }> = []

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const found = this.listening.get(type)
    if (found === undefined) this.listening.set(type, [listener])
    else found.push(listener)
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    const found = this.listening.get(type)
    if (found === undefined) return
    const at = found.indexOf(listener)
    if (at >= 0) found.splice(at, 1)
    if (found.length === 0) this.listening.delete(type)
  }

  dispatchEvent(event: { readonly type: string; readonly detail?: unknown }): void {
    // What a browser does to a plain object, and the reason replyOn exists: dispatchEvent is
    // specified to take an Event and nothing else. Throwing here instead of accepting it means
    // this stub cannot bless the mistake the real renderer refused ("parameter 1 is not of
    // type 'Event'"), the way a permissive fake blessed the two in docs/09 section 6.1.1.
    if (!(event instanceof Event)) {
      throw new TypeError('dispatchEvent: parameter 1 is not of type Event')
    }
    this.delivered.push(event)
  }

  /** What the page does: dispatch on the request event, then wait for the reply with its callId. */
  async ask(callId: string, endpoint: string, payload: unknown): Promise<unknown> {
    const listeners = [...(this.listening.get(BRIDGE_EVENT) ?? [])]
    for (const listener of listeners) {
      listener({ type: BRIDGE_EVENT, detail: { callId, endpoint, payload } })
    }
    // The answer is a promise chain, so poll the mailbox rather than assuming one microtask.
    for (let turn = 0; turn < 50; turn += 1) {
      const reply = this.delivered.find(
        (sent) => sent.type === BRIDGE_REPLY
          && (sent.detail as { callId?: string } | undefined)?.callId === callId,
      )
      if (reply !== undefined) return reply.detail
      await Promise.resolve()
    }
    return undefined
  }
}


function contextOf(config: { hasInject: boolean; configured?: boolean }) {
  const effects: Array<() => () => void> = []
  const injections: string[] = []
  const listeners: Listener[] = []
  const win = new FakeWindow()
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
  const context = {
    effect(callback: () => () => void): () => void {
      effects.push(callback)
      return () => undefined
    },
    inject: config.hasInject
      ? (names: string[], callback: (child: { credentials: FakeSeam }) => void): (() => void) => {
          for (const name of names) injections.push(name)
          callback({ credentials: seam })
          return () => undefined
        }
      : undefined,
    on(name: string, listener: Listener): () => void {
      expect(name).toBe(KEY_UPDATED_EVENT)
      listeners.push(listener)
      return () => undefined
    },
  }
  return { context, effects, injections, listeners, seam, win }
}


describe('the host half asks the seam only when somebody is reading the answer', () => {
  it('registers the route and asks nothing when no reader is given', async () => {
    const { context, effects, injections, seam, win } = contextOf({ hasInject: true })
    apply(context, { target: win })
    // apply() only registers its body; the channel is opened when effect() runs it, as cordis does.
    const disposers = effects.map(effect => effect())
    expect(injections).toEqual([])
    expect(seam.reads).toBeUndefined()
    // No service is asked for: the bridge is a window event, and a window needs no provider.
    // An ask is what puts it on the wire -- BRIDGE_EVENT is the page's half of the contract.
    expect(BRIDGE_EVENT).toBe('dsh-multipool:bridge')
    expect(win.listening.has(BRIDGE_EVENT)).toBe(true)
    const answered = (await win.ask('c1', 'snapshot', undefined)) as { ok: boolean; value: { badge: string } }
    expect(answered.ok).toBe(true)
    expect(answered.value.badge).toBe('0/0')
    for (const dispose of disposers) dispose()
    expect(win.listening.has(BRIDGE_EVENT)).toBe(false)
  })

  it('arms one read through the credentials service when a reader is given', async () => {
    const { context, effects, injections, win } = contextOf({ hasInject: true })
    const seen: KeyStatus[] = []
    apply(context, { target: win, onKeyStatus: status => seen.push(status) })
    const disposers = effects.map(effect => effect())

    expect(injections).toEqual(['credentials'])
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(seen).toHaveLength(1)
    expect(seen[0]?.kind).toBe('read')
    expect(seen[0]?.kind === 'read' ? seen[0].state : undefined).toEqual({ kind: 'absent' })

    for (const dispose of disposers) dispose()
  })

  it('activates when inject throws, which is what a half-resolved mock does', () => {
    // The shape a real install took: connection exists in some module table and not in the one
    // app-cordis asks, so inject() handed back a mock whose miss handler threw on any property read.
    // Nothing in this file asked about the missing service -- it read the one it wanted -- and the
    // entry still went down, taking the icon with it. A disabled plugin cannot draw dashes; this one
    // has to.
    const { context, effects, injections, win } = contextOf({ hasInject: true })
    context.inject = (names: string[], _callback: (child: never) => void) => {
      for (const name of names) injections.push(name)
      throw new TypeError('target.setProperty is not a function')
    }
    expect(() => apply(context, { target: win, onKeyStatus: () => undefined })).not.toThrow()
    const disposers = effects.map(effect => effect())
    expect(injections).toEqual(['credentials'])
    // Opened anyway, and closed without a word.
    expect(() => {
      for (const dispose of disposers) dispose()
    }).not.toThrow()
  })

  it('still opens the channel on a context that cannot inject', () => {
    const { context, effects, injections, seam, win } = contextOf({ hasInject: false })
    apply(context, { target: win, onKeyStatus: () => undefined })
    const disposers = effects.map(effect => effect())
    expect(injections).toEqual([])
    expect(seam.reads).toBeUndefined()
    // No seam was touched, and nothing threw on the way to saying so. The window listener is there
    // all the same: it is a window event, and no context can refuse one.
    expect(seam.reads).toBeUndefined()
    expect(win.listening.size).toBe(1)
    for (const dispose of disposers) dispose()
    expect(win.listening.size).toBe(0)
  })
})

describe('the bridge attaches to the window, and to nothing else', () => {
  it('attaches on effect(), not on apply(), and detaches when told to', () => {
    // apply() only registers its body -- cordis runs it. A bridge that wired itself here would also
    // outlive the disable that never ran the body, and this test would pass while the plugin leaked
    // a listener per load.
    const { context, effects, win } = contextOf({ hasInject: false })
    const dispose = apply(context, { target: win })
    const disposers = effects.map((effect) => effect())
    expect(win.listening.has(BRIDGE_EVENT)).toBe(true)
    for (const one of disposers) one()
    expect(win.listening.has(BRIDGE_EVENT)).toBe(false)
    dispose()
  })

  it('finds the window by name, and wires the bridge on it when asked with no target', () => {
    // No target handed in: the one path a real install takes -- and the one path the other 55
    // cases all skip by passing a stub. The window has to be found under `globalThis.window`.
    const here = globalThis as { window?: unknown }
    const had = Object.prototype.hasOwnProperty.call(here, 'window')
    const was = here.window
    const real = new FakeWindow()
    here.window = real
    try {
      const arrived = contextOf({ hasInject: false })
      const dispose = apply(arrived.context)
      const disposers = arrived.effects.map((effect) => effect())
      expect(real.listening.has(BRIDGE_EVENT)).toBe(true)
      for (const one of disposers) one()
      expect(real.listening.has(BRIDGE_EVENT)).toBe(false)
      dispose()
    } finally {
      if (had) here.window = was
      else delete here.window
    }
  })

  it('opens without a window at all, and wires nothing', () => {
    // A host process with no page: a headless run, a test, or a DSH whose renderer is not this one.
    // apply() must still come up -- an entry that throws is removed from the page entirely, which is
    // exactly how "where.addEventListener is not a function" made the plugin disappear.
    const here = globalThis as { window?: unknown }
    const had = Object.prototype.hasOwnProperty.call(here, 'window')
    const was = here.window
    delete here.window
    try {
      const arrived = contextOf({ hasInject: false })
      expect(() => apply(arrived.context)).not.toThrow()
      const disposers = arrived.effects.map((effect) => effect())
      expect(() => {
        for (const one of disposers) one()
      }).not.toThrow()
    } finally {
      if (had) here.window = was
    }
  })

  it('does not read the window off globalThis, which is a different object', () => {
    // The failure a real install reported was globalBridge() returning globalThis: addEventListener
    // was read off an object that does not have one, and the entry died inside apply() with
    // "where.addEventListener is not a function". Node has no globalThis.window here, so the wrong
    // lookup has nothing to find and apply() must still come up.
    const here = globalThis as { readonly window?: unknown; readonly addEventListener?: unknown }
    expect(here.addEventListener).toBeUndefined()
    expect(here.window).toBeUndefined()

    const arrived = contextOf({ hasInject: false })
    expect(() => apply(arrived.context, { target: arrived.win })).not.toThrow()
    const disposers = arrived.effects.map((effect) => effect())
    expect(arrived.win.listening.has(BRIDGE_EVENT)).toBe(true)
    for (const one of disposers) one()
  })

  it('closes what it opened, so a disable leaves the bus empty', () => {
    const arrived = contextOf({ hasInject: false, configured: true })
    apply(arrived.context, { target: arrived.win })
    const disposers = arrived.effects.map((effect) => effect())
    expect(arrived.win.listening.size).toBe(1)
    for (const one of disposers) one()
    expect(arrived.win.listening.size).toBe(0)
  })
})

describe('the host half hands writes to the page, and performs none itself', () => {
  type Answer = { ok: boolean; value?: unknown; error?: { code: string; message: string } }

  /**
   * The page's side of one command: POST the endpoint through the route apply() registered, and
   * unwrap the envelope the way client-connection does. Written out rather than imported so the
   * shape of the wire is asserted here and not only over there.
   */
  const commandOn = async (win: FakeWindow, request: unknown) => {
    const once = (await win.ask('c1', ENDPOINT_COMMAND, { request })) as Answer
    expect(once.ok).toBe(true)
    return once.value as { ok: boolean; reason?: string; status?: unknown; message?: string | null }
  }

  it('offers command() once accepted, and writes nothing just for being enabled', async () => {
    const { context, effects, seam, win } = contextOf({ hasInject: true })
    apply(context, { target: win, acceptsWrites: true })
    const disposers = effects.map(effect => effect())
    expect(typeof win.listening.get(BRIDGE_EVENT)?.[0]).toBe('function')
    // Arming opened the channel; it did not save, forget, or even read the seam.
    expect(seam.reads).toBeUndefined()
    for (const dispose of disposers) dispose()
  })

  it('refuses a save the store rejects, and says which rule in the store\'s words', async () => {
    const { context, effects, seam, win } = contextOf({ hasInject: true })
    apply(context, { target: win, acceptsWrites: true })
    const disposers = effects.map(effect => effect())
    const outcome = await commandOn(win, { name: 'save', key: 'sk-not-an-amd-key' })
    expect(outcome.ok).toBe(false)
    expect(outcome.reason).toBe('absent')
    expect(outcome.message).toContain('sk-')
    // The refused key never reached set(); the one read this command makes is that confirm re-read.
    expect(seam.reads).toBe(1)
    for (const dispose of disposers) dispose()
  })

  it('saves a well-formed key, then reports the seam rather than its own optimism', async () => {
    const { context, effects, seam, win } = contextOf({ hasInject: true, configured: true })
    apply(context, { target: win, acceptsWrites: true })
    const disposers = effects.map(effect => effect())
    const outcome = await commandOn(win, { name: 'save', key: 'rc-' + 'a'.repeat(32) })
    expect(outcome.ok).toBe(true)
    // Exactly the confirm read this command just made: the earlier ok case showed that arming
    // without a reader asks the seam nothing, and this count is what pins that down.
    expect(seam.reads).toBe(1)
    for (const dispose of disposers) dispose()
  })

  it('stays closed to writes when the host is not asked to accept them', async () => {
    const { context, effects, injections, win } = contextOf({ hasInject: true })
    apply(context, { target: win })
    const disposers = effects.map(effect => effect())
    expect(injections).toEqual([])
    expect(typeof win.listening.get(BRIDGE_EVENT)?.[0]).toBe('function')
    expect(await commandOn(win, { name: 'save', key: 'rc-' + 'a'.repeat(32) })).toEqual({
      ok: false,
      reason: 'no credential service',
    })
    for (const dispose of disposers) dispose()
  })
})
