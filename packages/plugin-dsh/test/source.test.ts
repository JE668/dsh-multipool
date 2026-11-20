import { describe, expect, it } from 'vitest'
import { buildSnapshot, createFakeClock, PROVIDER_ORDER, type Account } from '@dsh-multipool/core'
import { channelSourceFrom, NOTHING_READ } from '../src/source.js'
import { apply, CHANNEL_KEY } from '../src/index.js'
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

  it('apply() puts a channel on the global object and close() takes it away', () => {
    const effects: Array<() => void> = []
    const ctx = {
      effect(callback: () => () => void) {
        const dispose = callback()
        effects.push(dispose)
        return dispose
      },
    }
    const clock = createFakeClock({ now: NOW })
    apply(ctx, { nowMs: () => clock.now() })
    const installed = (globalThis as unknown as Record<string, unknown>)[CHANNEL_KEY] as {
      readonly view: () => { readonly attached: boolean }
    }
    expect(typeof installed.view).toBe('function')
    expect(installed.view().attached).toBe(true)
    for (const dispose of effects) dispose()
    expect((globalThis as unknown as Record<string, unknown>)[CHANNEL_KEY]).toBeUndefined()
  })
})
