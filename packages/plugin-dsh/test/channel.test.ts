import { describe, expect, it } from 'vitest'
import {
  CHANNEL_KEY,
  COMMAND_CLOSED,
  COMMAND_MALFORMED,
  COMMAND_NO_WRITES,
  COMMAND_UNKNOWN,
  openChannel,
  type ChannelSource,
  type ChannelTarget,
  type ChannelWrites,
} from '../src/channel.js'
import type { Account, MetricsEvent, ProviderId } from '@dsh-multipool/core'
import type { IconView } from '@dsh-multipool/plugin-client'

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
  }
}

class FakeWindow implements ChannelTarget {
  private bag: Record<string, unknown> = {}
  write(key: string, value: unknown): void {
    this.bag[key] = value
  }
  read(key: string): unknown {
    return this.bag[key]
  }
}

describe('channel', () => {
  it('is on the window before the first publish, and builds on demand', () => {
    const win = new FakeWindow()
    const handle = openChannel({ source: sourceOf([acct('amd', 'AMD-A', 'available')]), budget: BUDGET, target: win, pointsProviderId: 'amd' })
    const channel = win.read(CHANNEL_KEY) as { view: () => IconView }
    expect(handle.isPublished()).toBe(false)
    const view = channel.view()
    expect(handle.isPublished()).toBe(true)
    expect(view.attached).toBe(true)
    expect(view.badge).toBe('1/1')
    expect(view.lines.points).toContain('5.81')
    // A provider that never answered leaves no number behind, not a zero: NIM ships an
    // unavailable usage result, and nothing on the wire says 5.81 / 40 on its behalf.
    expect(handle.publish().wire).toContain('no-endpoint')
  })
  it('keeps the window key out of the wire, however the key is read', () => {
    const win = new FakeWindow()
    const handle = openChannel({
      source: sourceOf([acct('amd', 'AMD-A', 'available')]),
      budget: BUDGET,
      target: win,
      pointsProviderId: 'amd',
    })
    const published = handle.publish()
    expect(published.wire).not.toContain('SECRET')
    expect(published.wire).not.toContain('rc-')
    // The shape the page may call, not the data it carries: `command` and `offer` went in with
    // T-2-e and neither one puts key material on the window (channel.test.ts proves command()
    // refuses, and the writes it forwards are the seam's own calls, never the wire's).
    expect(Object.keys(win.read(CHANNEL_KEY) as object)).toEqual(['view', 'subscribe', 'command', 'offer'])
  })

  it('hands a new subscriber the current view, not a dash until the next publish', () => {
    const win = new FakeWindow()
    const handle = openChannel({
      source: sourceOf([acct('amd', 'AMD-A', 'available'), acct('amd', 'AMD-B', 'quota_unknown')]),
      budget: BUDGET,
      target: win,
      pointsProviderId: 'amd',
    })
    handle.publish()
    const channel = win.read(CHANNEL_KEY) as { subscribe: (fn: (v: IconView) => void) => () => void }
    const seen: string[] = []
    const off = channel.subscribe((view) => seen.push(view.badge))
    expect(seen).toEqual(['1/2'])
    off()
    handle.publish()
    expect(seen).toEqual(['1/2'])
  })

  it('republish() sends the last view without reading the source again', () => {
    const win = new FakeWindow()
    let reads = 0
    const base = sourceOf([acct('amd', 'AMD-A', 'available')])
    const counting: ChannelSource = {
      ...base,
      accounts: () => {
        reads += 1
        return base.accounts()
      },
    }
    const handle = openChannel({ source: counting, budget: BUDGET, target: win, pointsProviderId: 'amd' })
    expect(() => handle.republish()).toThrow(/publish\(\) has not run/)
    handle.publish()
    const after = reads
    handle.republish()
    expect(reads).toBe(after)
  })

  it('looks attached in the view it hands over -- only the browser dashes', () => {
    const win = new FakeWindow()
    const handle = openChannel({
      source: sourceOf([acct('amd', 'AMD-A', 'disabled')]),
      budget: BUDGET,
      target: win,
      pointsProviderId: 'amd',
    })
    const view = handle.publish().view
    expect(view.attached).toBe(true)
    expect(view.badge).toBe('0/1')
    expect(view.level).toBe('red')
  })

  it('close() removes the key and leaves nothing behind', () => {
    const win = new FakeWindow()
    const handle = openChannel({ source: sourceOf([]), budget: BUDGET, target: win, pointsProviderId: null })
    handle.publish()
    handle.close()
    expect(win.read(CHANNEL_KEY)).toBeUndefined()
    expect(handle.isPublished()).toBe(false)
  })

  it('defaults to the global object, where the page actually looks for it', () => {
    // No target: the install path the bundle takes in a real profile. globalThis is not a
    // window and has no setProperty -- a fake that only the test can construct would have
    // passed while the real one threw, which is exactly what happened once.
    const handle = openChannel({ source: sourceOf([acct('amd', 'AMD-A', 'available')]), budget: BUDGET })
    expect('setProperty' in globalThis).toBe(false)
    const channel = (globalThis as unknown as Record<string, unknown>)[CHANNEL_KEY] as { view: () => IconView }
    expect(typeof channel.view).toBe('function')
    expect(channel.view().badge).toBe('1/1')
    handle.close()
    expect((globalThis as unknown as Record<string, unknown>)[CHANNEL_KEY]).toBeUndefined()
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

  it('refuses a name it does not have, and does not spend a read on it', async () => {
    const win = new FakeWindow()
    const log = writesLog()
    const handle = openChannel({ source: sourceOf([]), budget: BUDGET, target: win, pointsProviderId: null, writes: log.writes })
    for (const request of [{ name: 'delete' }, { name: 'Save' }, { name: 'save me' }]) {
      await expect(handle.command(request)).resolves.toEqual({ ok: false, reason: COMMAND_UNKNOWN })
    }
    // The value is the store's to judge; a name this file does not know never gets that far.
    expect(log.calls).toEqual([])
    handle.close()
  })

  it('refuses a request that is not an object, rather than throwing into the click handler', async () => {
    const win = new FakeWindow()
    const log = writesLog()
    const handle = openChannel({ source: sourceOf([]), budget: BUDGET, target: win, pointsProviderId: null, writes: log.writes })
    for (const request of [null, undefined, 'save', 42, true]) {
      await expect(handle.command(request)).resolves.toEqual({ ok: false, reason: COMMAND_UNKNOWN })
    }
    expect(log.calls).toEqual([])
    handle.close()
  })

  it('passes a save on only when it carries the key text', async () => {
    const win = new FakeWindow()
    const log = writesLog()
    const handle = openChannel({ source: sourceOf([]), budget: BUDGET, target: win, pointsProviderId: null, writes: log.writes })
    expect(await handle.command({ name: 'save', key: 4242 })).toEqual({ ok: false, reason: COMMAND_MALFORMED })
    expect(await handle.command({ name: 'save' })).toEqual({ ok: false, reason: COMMAND_MALFORMED })
    expect(log.calls).toEqual([])
    const outcome = await handle.command({ name: 'save', key: 'rc-typed' })
    expect(log.calls).toEqual(['save rc-typed'])
    expect(outcome.ok).toBe(true)
    handle.close()
  })

  it('says no credential service rather than pretending a typo', async () => {
    const win = new FakeWindow()
    const handle = openChannel({ source: sourceOf([]), budget: BUDGET, target: win, pointsProviderId: null })
    expect(await handle.command({ name: 'save', key: 'rc-x' })).toEqual({ ok: false, reason: COMMAND_NO_WRITES })
    expect(await handle.command({ name: 'forget' })).toEqual({ ok: false, reason: COMMAND_NO_WRITES })
    handle.close()
  })

  it('takes the write half late, because ctx.inject resolves after openChannel', async () => {
    const win = new FakeWindow()
    const log = writesLog()
    const handle = openChannel({ source: sourceOf([]), budget: BUDGET, target: win, pointsProviderId: null })
    handle.offer(log.writes)
    expect(await handle.command({ name: 'forget' })).toEqual({
      ok: true,
      status: { present: false },
      message: null,
    })
    expect(log.calls).toEqual(['forget'])
    handle.close()
  })

  it('refuses after close(), and ignores an offer made after it', async () => {
    const win = new FakeWindow()
    const log = writesLog()
    const handle = openChannel({ source: sourceOf([]), budget: BUDGET, target: win, pointsProviderId: null })
    handle.offer(log.writes)
    handle.close()
    expect(await handle.command({ name: 'save', key: 'rc-x' })).toEqual({ ok: false, reason: COMMAND_CLOSED })
    const late = writesLog()
    handle.offer(late.writes)
    expect(await handle.command({ name: 'save', key: 'rc-x' })).toEqual({ ok: false, reason: COMMAND_CLOSED })
    // A closed channel writes nothing, whoever offered what and whenever.
    expect(log.calls).toEqual([])
    expect(late.calls).toEqual([])
  })
})
