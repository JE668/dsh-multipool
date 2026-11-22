import { describe, expect, it } from 'vitest'
import { buildSnapshot, createFakeClock, PROVIDER_ORDER, type Account } from '@dsh-multipool/core'
import { channelSourceFrom, NOTHING_READ } from '../src/source.js'
import { apply, BRIDGE_EVENT, BRIDGE_REPLY, ENDPOINT_SNAPSHOT } from '../src/index.js'
import type { ChannelSource } from '../src/channel.js'

/** The four methods key-store.ts calls on a credential seam, and nothing else. */
interface FakeSeam {
  resolve(ref: string): Promise<undefined>
  describe(ref: string): Promise<{ configured: boolean; writable: boolean }>
  set(ref: string, value: string): Promise<void>
  unset(ref: string): Promise<void>
}

const NOW = Date.UTC(2026, 11, 1, 1, 0, 0)

function acct(status: Account['status']): Account {
  return {
    providerId: 'amd',
    accountAlias: 'AMD-A',
    keyIdMasked: 'amd-\u20261a2b',
    enabled: true,
    status,
    limits: {},
  }
}

function snapshotOf(source: ChannelSource) {
  return buildSnapshot(
    {
      accounts: source.accounts(),
      events: source.events(),
      usage: source.usage(),
      activeSessions: source.activeSessions(),
      queued: source.queued(),
      nowMs: source.nowMs(),
    },
    PROVIDER_ORDER,
  )
}

describe('the host half publishes what it has read, and nothing it has not', () => {
  it('claims no configured pool while no key store has answered', () => {
    // The failure this guards is the one a live install showed: apply() opened the channel, the
    // browser half found it false, and the icon painted grey -- "disabled" -- for a plugin that
    // was merely waiting to read its first key.
    const source = channelSourceFrom(NOTHING_READ, () => NOW)
    const snapshot = snapshotOf(source)
    expect(snapshot.overall.configured).toBe(false)
    expect(snapshot.overall.total).toBe(0)
    expect(snapshot.generatedAtMs).toBe(NOW)
  })

  it('still claims nothing configured when every fact is an empty list', () => {
    const source = channelSourceFrom(
      { accounts: [], events: [], usage: {}, activeSessions: 0, queued: 0 },
      () => NOW,
    )
    const snapshot = snapshotOf(source)
    expect(snapshot.overall.configured).toBe(false)
    expect(snapshot.providers.every(p => p.tally.total === 0)).toBe(true)
  })

  it('counts an account the moment a source reports one', () => {
    const source = channelSourceFrom(
      {
        accounts: [acct('available'), acct('rate_limited')],
        events: [],
        usage: {},
        activeSessions: 1,
        queued: 2,
      },
      () => NOW,
    )
    const snapshot = snapshotOf(source)
    expect(snapshot.overall.configured).toBe(true)
    expect(snapshot.overall.total).toBe(2)
    expect(snapshot.overall.available).toBe(1)
    expect(snapshot.counters.queued).toBe(2)
    expect(snapshot.counters.activeSessions).toBe(1)
  })

  it('leaves a provider without a usage reading out of the map instead of passing null', () => {
    const source = channelSourceFrom(NOTHING_READ, () => NOW)
    expect(source.usage()).toEqual({})
    expect(Object.keys(source.usage())).toEqual([])
  })

  it('apply() puts a listener on the window and close() takes it off', async () => {
    const effects: Array<() => void> = []
    const listening = new Map<string, Array<(event: unknown) => void>>()
    const delivered: unknown[] = []
    const win = {
      addEventListener(type: string, listener: (event: unknown) => void) {
        const found = listening.get(type)
        if (found === undefined) listening.set(type, [listener])
        else found.push(listener)
      },
      removeEventListener(type: string, listener: (event: unknown) => void) {
        const found = listening.get(type)
        if (found === undefined) return
        const at = found.indexOf(listener)
        if (at >= 0) found.splice(at, 1)
        if (found.length === 0) listening.delete(type)
      },
      dispatchEvent(event: { readonly type: string; readonly detail?: unknown }) {
        delivered.push(event.detail)
      },
    }
    const seamLike: FakeSeam = {
      resolve: async () => undefined,
      describe: async () => ({ configured: false, writable: true }),
      set: async () => undefined,
      unset: async () => undefined,
    }
    const injected: string[][] = []
    const ctx = {
      effect(callback: () => () => void) {
        const dispose = callback()
        effects.push(dispose)
        return dispose
      },
      inject(names: string[], callback: (child: { credentials?: FakeSeam }) => void) {
        injected.push(names)
        callback({ credentials: seamLike })
        return () => undefined
      },
    }
    const clock = createFakeClock({ now: NOW })
    apply(ctx, { nowMs: () => clock.now(), target: win })
    // A window needs no provider: the initial arm asks the context for nothing at all.
    expect(injected).toEqual([])
    // Only the credentials seam is asked for, and only because acceptsWrites hands out the
    // write half -- there is no connection service left to inject (T-2-e).
    expect(listening.has(BRIDGE_EVENT)).toBe(true)

    win.dispatchEvent({ type: BRIDGE_EVENT, detail: { callId: 'c1', endpoint: ENDPOINT_SNAPSHOT } })
    for (let turn = 0; turn < 50 && delivered.length === 0; turn += 1) await Promise.resolve()
    expect(delivered).toHaveLength(1)
  })
})
