import { describe, expect, it } from 'vitest'
import { CHANNEL_KEY, openChannel, type ChannelSource, type ChannelTarget } from '../src/channel.js'
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
  setProperty(key: string, value: unknown): void {
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
    expect(Object.keys(win.read(CHANNEL_KEY) as object)).toEqual(['view', 'subscribe'])
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
})
