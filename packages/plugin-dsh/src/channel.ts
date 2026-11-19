/**
 * The host side of the left-bar icon (docs/05 section 2.3, T-2-b).
 *
 * The browser half runs in the page's module table and cannot call into this process, so what
 * it reads is whatever publish() last put on one window key. Nothing else crosses: not the key
 * store, not the scheduler, not the proxy.
 *
 * Two rules shape the code below.
 *
 * 1. Publishing happens when the caller says so. There is no timer and no subscription of our
 *    own, because a timer here would eventually become a request the user did not make -- the
 *    same mistake docs/05 section 4.3 bans for the dashboard.
 * 2. Absence stays absent. A provider whose usage endpoint has not answered ships without its
 *    numbers, not with zeroes, so the icon has no zero it could mistake for a reading.
 */

import {
  buildSnapshot,
  PROVIDER_ORDER,
  serializeSnapshot,
  type Account,
  type MetricsEvent,
  type ProviderId,
  type Snapshot,
  type UsageResult,
} from '@dsh-multipool/core'
import { iconViewOf, type IconView } from '@dsh-multipool/plugin-client'

/** The key the browser half reads. Must match CHANNEL in packages/client-ui/client.js. */
export const CHANNEL_KEY = '@dsh-multipool/plugin-client/view'

/** What the browser half calls. Mirrors the shape client.js expects on window[CHANNEL_KEY]. */
export interface Channel {
  readonly view: () => IconView
  readonly subscribe: (listener: (view: IconView) => void) => () => void
}

export interface ChannelSource {
  readonly accounts: () => readonly Account[]
  readonly events: () => readonly MetricsEvent[]
  /** Latest /v1/usage reading per provider; a provider with none stays out of the map. */
  readonly usage: () => Readonly<Partial<Record<ProviderId, UsageResult | null>>>
  readonly activeSessions: () => number
  readonly queued: () => number
  /** The one clock. This module never reads Date.now itself. */
  readonly nowMs: () => number
}

/** The account-level budget the icon prints, already computed by whatever owns the formula. */
export interface IconBudget {
  readonly admitRpm: number
  readonly sources: readonly string[]
}

/** Narrow seam over the global object, so a test can hand in a bare one. */
export interface ChannelTarget {
  readonly setProperty: (key: string, value: unknown) => void
}

export interface PublishedView {
  readonly snapshot: Snapshot
  readonly view: IconView
  /** The scrubbed JSON. Kept beside the view so a test can assert the wire carries no key. */
  readonly wire: string
}

export interface OpenChannelOptions {
  readonly source: ChannelSource
  readonly budget: IconBudget
  readonly target?: ChannelTarget
  /** Which provider line three's point count comes from; null prints only the dash. */
  readonly pointsProviderId?: ProviderId | null
}

export interface ChannelHandle {
  /** Rebuild from current state, hand the result to every subscriber, and return it. */
  readonly publish: () => PublishedView
  /** Re-send the last built view without reading the source again. */
  readonly republish: () => PublishedView
  readonly isPublished: () => boolean
  /** Drop every subscriber and remove the window key. The channel is dead afterwards. */
  readonly close: () => void
}

/** republish() before publish() has nothing to send, and a silent empty send reads as a bug. */
const NO_SUBSCRIBERS = 'publish() has not run yet; there is no view to re-send'

export function buildPublishedView(
  source: ChannelSource,
  budget: IconBudget,
  pointsProviderId: ProviderId | null,
): PublishedView {
  const snapshot = buildSnapshot(
    {
      accounts: source.accounts(),
      events: source.events(),
      nowMs: source.nowMs(),
      activeSessions: source.activeSessions(),
      queued: source.queued(),
      usage: source.usage(),
    },
    PROVIDER_ORDER,
  )
  // attached is true on purpose: the browser half only calls view() when it found this
  // channel, and this file exists only inside the host. The path that flips it back is
  // the browser's missing-channel branch, which never reaches us.
  const view = iconViewOf({ snapshot, budget, pointsProviderId, attached: true })
  return { snapshot, view, wire: serializeSnapshot(snapshot) }
}

/**
 * Opens the channel and returns the handle.
 *
 * The window key is installed before this returns, so the browser half always has something
 * to call -- even if the first publish() has not happened yet, view() builds a snapshot on
 * demand.
 */
export function openChannel(options: OpenChannelOptions): ChannelHandle {
  const target: ChannelTarget = options.target === undefined
    ? (globalThis as unknown as ChannelTarget)
    : options.target
  const pointsProviderId: ProviderId | null = options.pointsProviderId === undefined
    ? null
    : options.pointsProviderId

  const subscribers = new Set<(view: IconView) => void>()
  let last: PublishedView | null = null
  let closed = false

  const build = (): PublishedView => buildPublishedView(options.source, options.budget, pointsProviderId)

  const channel: Channel = {
    view() {
      if (last === null) last = build()
      return last.view
    },
    subscribe(listener: (view: IconView) => void): () => void {
      if (closed) return () => undefined
      subscribers.add(listener)
      // A late subscriber gets today's view rather than a dash until the next publish -- the
      // host being up is exactly what it should not have to wait to learn.
      if (last !== null) listener(last.view)
      return () => {
        subscribers.delete(listener)
      }
    },
  }

  target.setProperty(CHANNEL_KEY, channel)

  return {
    publish(): PublishedView {
      const next = build()
      last = next
      // Publishing after close() would put the key back on a window that already unloaded us.
      if (closed) return next
      for (const listener of subscribers) listener(next.view)
      return next
    },
    republish(): PublishedView {
      if (last === null) throw new Error(NO_SUBSCRIBERS)
      if (!closed) for (const listener of subscribers) listener(last.view)
      return last
    },
    isPublished(): boolean {
      return last !== null
    },
    close(): void {
      closed = true
      subscribers.clear()
      target.setProperty(CHANNEL_KEY, undefined)
      last = null
    },
  }
}
