import { describe, expect, it } from 'vitest'
import { buildSnapshot, createFakeClock, PROVIDER_ORDER, type Account } from '@dsh-multipool/core'
import { channelSourceFrom, NOTHING_READ } from '../src/source.js'
import type { ConnectionContext } from '../src/index.js'
import { apply, CHANNEL, ENDPOINT_SNAPSHOT } from '../src/index.js'
import type { ChannelSource } from '../src/channel.js'

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

  it('apply() serves a route and close() takes it away', async () => {
    const effects: Array<() => void> = []
    const routes = new Map<string, (endpoint: string, payload: unknown) => Promise<unknown>>()
    const ctx = {
      effect(callback: () => () => void) {
        const dispose = callback()
        effects.push(dispose)
        return dispose
      },
      inject(names: string[], callback: (child: ConnectionContext) => void) {
        expect(names).toEqual(['connection'])
        callback({
          connection: {
            rpc: {
              handle(channel: string, handler: (endpoint: string, payload: unknown) => Promise<unknown>) {
                routes.set(channel, handler)
                return () => {
                  routes.delete(channel)
                }
              },
            },
          },
        })
        return () => undefined
      },
    }
    const clock = createFakeClock({ now: NOW })
    apply(ctx, { nowMs: () => clock.now() })
    const served = routes.get(CHANNEL)
    expect(typeof served).toBe('function')
    // The route answers the icon view, and that view is attached: the window key this replaced
    // could never be seen from the other process, whatever this boolean said.
    const answer = (await served?.(ENDPOINT_SNAPSHOT, undefined)) as { ok: boolean; value: { attached: boolean } }
    expect(answer.ok).toBe(true)
    expect(answer.value.attached).toBe(true)
    for (const dispose of effects) dispose()
  })
})
