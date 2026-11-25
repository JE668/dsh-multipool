import { beforeEach, describe, expect, it } from 'vitest'
import {
  COMMAND_CLOSED,
  COMMAND_MALFORMED,
  COMMAND_NO_WRITES,
  COMMAND_UNKNOWN,
  ENDPOINT_COMMAND,
  ENDPOINT_SNAPSHOT,
  ENDPOINT_TEST,
  NO_TEST_SOURCE,
  TEST_PROVIDER,
  answerOf,
  openChannel,
  type ChannelSource,
  type ChannelWrites,
} from '../src/channel.js'

import type { Account, MetricsEvent, ProviderId } from '@dsh-multipool/core'
import type { IconView } from '@dsh-multipool/plugin-client'
import type { UsageAttempt } from '../src/usage.js'

const NOW = Date.UTC(2026, 10, 19, 2, 0, 0)
const BUDGET = { admitRpm: 11, sources: ['min(20,30)*0.85/1.5=11'] }

function acct(providerId: ProviderId, alias: string, status: Account['status']): Account {
  return {
    providerId,
    accountAlias: alias,
    keyIdMasked: providerId + '-\u20261a2b',
    enabled: true,
    status,
    limits: {},
  }
}

function sourceOf(accounts: readonly Account[], events: readonly MetricsEvent[] = []): ChannelSource {
  return {
    accounts: () => accounts,
    events: () => events,
    usage: () => ({
      amd: {
        available: true,
        dailyUsedPts: { value: 5.81, source: 'api' },
        dailyLimitPts: { value: 40, source: 'api' },
        fetchedAt: '2026-11-19T01:41:00Z',
      },
      nim: { available: false, reason: 'no-endpoint' },
    }),
    activeSessions: () => 2,
    queued: () => 0,
    nowMs: () => NOW,
    reading: () => (accounts.length === 0 ? 'empty' : 'read'),
  }
}

const viewOf = (answer: unknown): IconView => (answer as { value: { view: IconView } }).value.view

describe('channel', () => {
  it('answers before the first publish, and builds on demand', async () => {
    const handle = openChannel({
      source: sourceOf([acct('amd', 'AMD-A', 'available')]),
      budget: BUDGET,
      pointsProviderId: 'amd',
    })
    const answer = answerOf(handle)
    expect(handle.isPublished()).toBe(false)
    const view = viewOf(await answer(ENDPOINT_SNAPSHOT, {}))
    expect(handle.isPublished()).toBe(true)
    expect(view.attached).toBe(true)
    expect(view.badge).toBe('1/1')
    expect(view.lines.points).toContain('5.81')
    // A provider that never answered leaves no number behind, not a zero: NIM ships an
    // unavailable usage result, and nothing on the wire says 5.81 / 40 on its behalf.
    expect(handle.publish().wire).toContain('no-endpoint')
  })

  it('sends the layer with the view, and leaves the field out when there is none', async () => {
    // The page prints "stored in <layer>" and must never print a layer nobody reported. So an absent
    // layer has to be absent from the object, not present as undefined: a page checking for the
    // member would otherwise read the second as a reading about the seam.
    const told = openChannel({
      source: { ...sourceOf([acct('amd', 'AMD-A', 'available')]), keyLayer: () => 'env' as const },
      budget: BUDGET,
      pointsProviderId: 'amd',
    })
    const fromEnv = (await answerOf(told)(ENDPOINT_SNAPSHOT, {})) as {
      value: { layer?: string }
    }
    expect(fromEnv.value.layer).toBe('env')

    const silent = openChannel({
      source: sourceOf([acct('amd', 'AMD-A', 'available')]),
      budget: BUDGET,
      pointsProviderId: 'amd',
    })
    const unread = (await answerOf(silent)(ENDPOINT_SNAPSHOT, {})) as {
      value: { layer?: string }
    }
    expect('layer' in unread.value).toBe(false)
  })

  it('keeps the key out of the wire, however the key is read', () => {
    const handle = openChannel({
      source: sourceOf([acct('amd', 'AMD-A', 'available')]),
      budget: BUDGET,
      pointsProviderId: 'amd',
    })
    const published = handle.publish()
    expect(published.wire).not.toContain('SECRET')
    expect(published.wire).not.toContain('rc-')
    // The answer is JSON. A function in here would be dropped by the transport without a word,
    // and the page would print its dashes while every test in this file stayed green -- which is
    // how the window key survived three green suites and one broken install.
    expect(JSON.parse(JSON.stringify(published.view))).toEqual(published.view)
  })

  it('rebuilds on every call, so the second answer is not the first one frozen', async () => {
    let accounts: Account[] = [acct('amd', 'AMD-A', 'available')]
    const source: ChannelSource = { ...sourceOf([]), accounts: () => accounts }
    const answer = answerOf(openChannel({ source, budget: BUDGET, pointsProviderId: 'amd' }))
    expect(viewOf(await answer(ENDPOINT_SNAPSHOT, undefined)).badge).toBe('1/1')
    accounts = [acct('amd', 'AMD-A', 'available'), acct('amd', 'AMD-B', 'available')]
    expect(viewOf(await answer(ENDPOINT_SNAPSHOT, undefined)).badge).toBe('2/2')
  })

  it('looks attached in the view it hands over -- only the browser dashes', () => {
    const handle = openChannel({
      source: sourceOf([acct('amd', 'AMD-A', 'disabled')]),
      budget: BUDGET,
      pointsProviderId: 'amd',
    })
    const view = handle.publish().view
    expect(view.attached).toBe(true)
    expect(view.badge).toBe('0/1')
    expect(view.level).toBe('red')
  })

  it('refuses an endpoint it does not have, and names it', async () => {
    const answer = answerOf(openChannel({ source: sourceOf([]), budget: BUDGET, pointsProviderId: null }))
    expect(await answer('save', { request: { name: 'save', key: 'rc-x' } })).toEqual({
      ok: false,
      error: { code: 'multipool/unknown-endpoint', message: 'no endpoint "save"' },
    })
    expect(await answer('', undefined)).toEqual({
      ok: false,
      error: { code: 'multipool/unknown-endpoint', message: 'no endpoint ""' },
    })
  })

  it('close() leaves the channel answering nothing it can honour', async () => {
    const handle = openChannel({ source: sourceOf([]), budget: BUDGET, pointsProviderId: null })
    const answer = answerOf(handle)
    handle.publish()
    handle.close()
    expect(handle.isPublished()).toBe(false)
    const after = await answer(ENDPOINT_COMMAND, { request: { name: 'save', key: 'rc-x' } })
    expect(after).toEqual({ ok: true, value: { ok: false, reason: COMMAND_CLOSED } })
  })

  it('registers nothing on globalThis, which both processes can see and neither can share', () => {
    const before = Object.keys(globalThis).length
    const handle = openChannel({ source: sourceOf([acct('amd', 'AMD-A', 'available')]), budget: BUDGET })
    handle.publish()
    handle.close()
    expect(Object.keys(globalThis).length).toBe(before)
  })
})

describe('the command half (T-2-e)', () => {
  function writesLog() {
    const calls: string[] = []
    const writes: ChannelWrites = {
      save: async (key: string) => {
        calls.push('save ' + key)
        return { ok: true, status: { present: true, layer: 'file' }, message: null }
      },
      forget: async () => {
        calls.push('forget')
        return { ok: true, status: { present: false }, message: null }
      },
    }
    return { calls, writes }
  }

  const commandThrough = async (handle: ReturnType<typeof openChannel>, request: unknown) => {
    const answer = await answerOf(handle)(ENDPOINT_COMMAND, { request })
    return (answer as { value: unknown }).value
  }

  it('refuses a name it does not have, and does not spend a read on it', async () => {
    const log = writesLog()
    const handle = openChannel({ source: sourceOf([]), budget: BUDGET, pointsProviderId: null, writes: log.writes })
    for (const request of [{ name: 'delete' }, { name: 'Save' }, { name: 'save me' }]) {
      expect(await commandThrough(handle, request)).toEqual({ ok: false, reason: COMMAND_UNKNOWN })
    }
    // The value is the store's to judge; a name this file does not know never gets that far.
    expect(log.calls).toEqual([])
    handle.close()
  })

  it('refuses a request that is not an object, rather than throwing into the click handler', async () => {
    const log = writesLog()
    const handle = openChannel({ source: sourceOf([]), budget: BUDGET, pointsProviderId: null, writes: log.writes })
    for (const request of [null, undefined, 'save', 42, true]) {
      expect(await commandThrough(handle, request)).toEqual({ ok: false, reason: COMMAND_UNKNOWN })
    }
    expect(log.calls).toEqual([])
    handle.close()
  })

  it('passes a save on only when it carries the key text', async () => {
    const log = writesLog()
    const handle = openChannel({ source: sourceOf([]), budget: BUDGET, pointsProviderId: null, writes: log.writes })
    expect(await commandThrough(handle, { name: 'save', key: 4242 })).toEqual({ ok: false, reason: COMMAND_MALFORMED })
    expect(await commandThrough(handle, { name: 'save' })).toEqual({ ok: false, reason: COMMAND_MALFORMED })
    expect(log.calls).toEqual([])
    expect(await commandThrough(handle, { name: 'save', key: 'rc-typed' })).toEqual({
      ok: true,
      status: { present: true, layer: 'file' },
      message: null,
    })
    expect(log.calls).toEqual(['save rc-typed'])
    handle.close()
  })

  it('says no credential service rather than pretending a typo', async () => {
    const handle = openChannel({ source: sourceOf([]), budget: BUDGET, pointsProviderId: null })
    expect(await commandThrough(handle, { name: 'save', key: 'rc-x' })).toEqual({ ok: false, reason: COMMAND_NO_WRITES })
    expect(await commandThrough(handle, { name: 'forget' })).toEqual({ ok: false, reason: COMMAND_NO_WRITES })
    handle.close()
  })

  it('takes the write half late, because ctx.inject resolves after openChannel', async () => {
    const log = writesLog()
    const handle = openChannel({ source: sourceOf([]), budget: BUDGET, pointsProviderId: null })
    handle.offer(log.writes)
    expect(await commandThrough(handle, { name: 'forget' })).toEqual({
      ok: true,
      status: { present: false },
      message: null,
    })
    expect(log.calls).toEqual(['forget'])
    handle.close()
  })

  it('refuses after close(), and ignores an offer made after it', async () => {
    const log = writesLog()
    const handle = openChannel({ source: sourceOf([]), budget: BUDGET, pointsProviderId: null })
    handle.offer(log.writes)
    handle.close()
    expect(await commandThrough(handle, { name: 'save', key: 'rc-x' })).toEqual({ ok: false, reason: COMMAND_CLOSED })
    const late = writesLog()
    handle.offer(late.writes)
    expect(await commandThrough(handle, { name: 'save', key: 'rc-x' })).toEqual({ ok: false, reason: COMMAND_CLOSED })
    // A closed channel writes nothing, whoever offered what and whenever.
    expect(log.calls).toEqual([])
    expect(late.calls).toEqual([])
  })
})

describe('the test half (T-2-f)', () => {
  const asked = (providerId: string): Promise<UsageAttempt> => {
    calls.push(providerId)
    return Promise.resolve({
      providerId: 'amd' as ProviderId,
      usage: { available: true, fetchedAt: 'x' },
      said: '',
      atMs: 1,
      tooSoon: false,
    })
  }
  let calls: string[] = []
  beforeEach(() => {
    calls = []
  })

  it('asks the provider it was told about, and amd when it was told nothing', async () => {
    const answer = answerOf(openChannel({ source: sourceOf([]), budget: BUDGET, pointsProviderId: null }), {
      accounts: () => [],
      events: () => [],
      usage: () => ({}),
      activeSessions: () => 0,
      queued: () => 0,
      nowMs: () => 0,
      reading: () => 'read',
      testUsage: asked,
    })
    await answer(ENDPOINT_TEST, { [TEST_PROVIDER]: 'nim' })
    await answer(ENDPOINT_TEST, {})
    // Absent means the one the icon prints, not the one that happens to be first in a list.
    expect(calls).toEqual(['nim', 'amd'])
  })

  it('refuses the test by name when this host has nothing that can ask', async () => {
    const answer = answerOf(openChannel({ source: sourceOf([]), budget: BUDGET, pointsProviderId: null }))
    const whole = (await answer(ENDPOINT_TEST, {})) as { ok: boolean; error?: { code: string } }
    expect(whole.ok).toBe(false)
    expect(whole.error?.code).toBe(NO_TEST_SOURCE)
  })
})
