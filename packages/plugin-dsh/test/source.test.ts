import { describe, expect, it } from 'vitest'
import { buildSnapshot, createFakeClock, PROVIDER_ORDER, type Account } from '@dsh-multipool/core'
import { channelSourceFrom, NOTHING_READ } from '../src/source.js'
import { apply, CHANNEL, ENDPOINT_SNAPSHOT } from '../src/index.js'
import type { ChannelSource, Route, RouteServer } from '../src/channel.js'

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
      { accounts: [], events: [], usage: {}, activeSessions: 0, queued: 0, keyLayer: undefined },
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
        keyLayer: undefined,
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

  it('apply() claims one route and close() gives it back', async () => {
    const claimed = new Map<string, Route>()
    const seamLike: FakeSeam = {
      resolve: async () => undefined,
      describe: async () => ({ configured: false, writable: true }),
      set: async () => undefined,
      unset: async () => undefined,
    }
    const injected: string[][] = []
    const effects: Array<() => void> = []
    const server: RouteServer = {
      register(route: Route) {
        claimed.set(route.path, route)
        return () => {
          claimed.delete(route.path)
        }
      },
    }
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
    apply(ctx, { nowMs: () => clock.now(), server })
    // The route needs no provider, but the key does: the seam is asked for whenever the icon paints.
    expect(injected).toEqual([['credentials']])
    expect(claimed.has(CHANNEL)).toBe(true)

    const route = claimed.get(CHANNEL)
    expect(route !== undefined).toBe(true)
    const asked: Array<{ status: number; body: string }> = []
    const req = {
      method: 'POST',
      url: CHANNEL + '/' + ENDPOINT_SNAPSHOT,
      async *[Symbol.asyncIterator]() {
        yield Buffer.from('{}')
      },
    }
    const res = {
      writeHead(status: number) {
        asked.push({ status, body: '' })
      },
      end(body?: string) {
        const last = asked[asked.length - 1]
        if (last !== undefined) last.body = body ?? ''
      },
    }
    await route?.handler(req, res)
    expect(asked).toHaveLength(1)
    const answered = JSON.parse(asked[0]?.body ?? '{}') as { ok: boolean; value: { view: { attached: boolean } } }
    expect(answered.ok).toBe(true)
    expect(answered.value.view.attached).toBe(true)

    for (const dispose of effects) dispose()
    expect(claimed.has(CHANNEL)).toBe(false)
  })
})
