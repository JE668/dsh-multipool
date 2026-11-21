/**
 * The host side of the left-bar icon (docs/05 section 2.3, T-2-b).
 *
 * The browser half runs in the page's module table and cannot call into this process, so what
 * it reads is whatever publish() last put on one window key. Nothing else crosses: not the key
 * store, not the scheduler, not the proxy -- except a command, which travels the other way on
 * that same key and only when the page asks for one (T-2-e).
 *
 * Three rules shape the code below.
 *
 * 1. Publishing happens when the caller says so. There is no timer and no subscription of our
 *    own, because a timer here would eventually become a request the user did not make -- the
 *    same mistake docs/05 section 4.3 bans for the dashboard.
 * 2. Absence stays absent. A provider whose usage endpoint has not answered ships without its
 *    numbers, not with zeroes, so the icon has no zero it could mistake for a reading.
 * 3. A command name we do not know is refused, not ignored. Listing the two that exist makes the
 *    extension surface one line long, so adding a third is a diff someone reviews rather than a
 *    typo that silently does nothing.
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
import type { KeyLayer } from './key-store.js'

/** The key the browser half reads. Must match CHANNEL in packages/client-ui/client.js. */
export const CHANNEL_KEY = '@dsh-multipool/plugin-client/view'

/** What the browser half calls. Mirrors the shape client.js expects on window[CHANNEL_KEY]. */
export interface Channel {
  readonly view: () => IconView
  readonly subscribe: (listener: (view: IconView) => void) => () => void
  /**
   * Ask the host to do one named thing.
   *
   * The only message that travels from page to host. Its argument is `unknown` because the page
   * is the one place a command arrives without having been typed: a name this file has never
   * heard of is a refusal, never a TypeError thrown into the caller's click handler.
   */
  readonly command: (request: unknown) => Promise<CommandOutcome>
  /**
   * Attach the write half after `openChannel`.
   *
   * The write seam reaches `apply` through `ctx.inject`, which resolves later than the channel is
   * opened, so the channel has to accept it late -- and refuse commands until it does, rather than
   * answering "no credential service" about a service that simply has not arrived yet.
   */
  readonly offer: (writes: ChannelWrites) => void
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

/**
 * Narrow seam over the global object, so a test can hand in a bare one.
 *
 * Both members are plain property assignment on purpose: the host process has no `window`, and
 * `globalThis` has no `setProperty` -- the first install died on `target.setProperty is not a
 * function` for assuming one. The browser half finds the key by reading `window[CHANNEL]`, so a
 * property that is simply there is what it needs; no method has to be invented to put it there.
 */
export interface ChannelTarget {
  readonly write: (key: string, value: unknown) => void
}

/** The real global object, addressed as `ChannelTarget`. */
function globalTarget(): ChannelTarget {
  return {
    write(key: string, value: unknown): void {
      ;(globalThis as unknown as Record<string, unknown>)[key] = value
    },
  }
}


/** The ref this plugin stores its one key under; the form's field is named after it. */
export const AMD_KEY_REF_NAME = 'AMD_API_KEY'

/**
 * What the page may ask the host to do.
 *
 * `save` and `forget` are the only two, and they are deliberately not a generic "write this
 * somewhere": each names one seam method (set, unset) and the one reference it may touch. A page
 * that could ask for an arbitrary ref would be asking this plugin to hold somebody else's key.
 */
export type ChannelCommandName = 'save' | 'forget'

/** Refused because the name is not one of the two; nothing was attempted. */
export const COMMAND_UNKNOWN = 'unknown command'
/** Refused because a field does not have the type the command needs; nothing was attempted. */
export const COMMAND_MALFORMED = 'malformed command'
/** Refused because this channel was closed before the command arrived. */
export const COMMAND_CLOSED = 'channel is closed'
/** Refused because this install has no credential service to write through. */
export const COMMAND_NO_WRITES = 'no credential service'

/** What the seam says about the key now, minus the seam itself: `seam` is a live object, not wire. */
export interface KeyReading {
  readonly present: boolean
  readonly layer?: KeyLayer
}

export interface CommandOutcome {
  /** True only when the command ran; a refusal says why in `reason` and writes nothing. */
  readonly ok: boolean
  /** Why a command was refused. Undefined when ok: the honest text comes from the store. */
  readonly reason?: string
  /**
   * What the seam says, re-read after the attempt. Absent when nothing was attempted.
   *
   * `KeyStatus` carries the seam object itself so in-process callers can chain another call on it.
   * That object would be a function-valued property on anything crossing to the page, so the
   * channel flattens it to the one bit the icon needs: is a key there now, and in which layer.
   */
  readonly status?: KeyReading
  /** The store's own reply, refusals included (docs/02 section 1.2), already scrubbed. */
  readonly message?: string | null
}

/**
 * Where the channel sends writes. Absent when the host has no credential service, which is a
 * state the page must be able to show rather than a reason to refuse activation.
 */
export interface ChannelWrites {
  readonly save: (key: string) => Promise<CommandOutcome>
  readonly forget: () => Promise<CommandOutcome>
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
  /**
   * The write half of the key seam, or nothing at all when this install has no credential service.
   *
   * Optional on purpose (T-2-e): a DSH without dsh-credentials-local still gets an icon, and its
   * command() answers "no service" instead of the plugin refusing to activate.
   */
  readonly writes?: ChannelWrites
}

export interface ChannelHandle {
  /** Rebuild from current state, hand the result to every subscriber, and return it. */
  readonly publish: () => PublishedView
  /** Re-send the last built view without reading the source again. */
  readonly republish: () => PublishedView
  readonly isPublished: () => boolean
  readonly command: (request: unknown) => Promise<CommandOutcome>
  /** Attach the write half once the credential seam resolves. */
  readonly offer: (writes: ChannelWrites) => void
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

/** The name a command request carries. One field, because there is one question. */
const COMMAND_NAME = 'name'
const COMMAND_KEY = 'key'

const SAVE_OR_FORGET: readonly string[] = ['save', 'forget']

/**
 * Run one command, or say why it cannot run.
 *
 * The order matters: closed, then unknown, then no-service. An install with no credential service
 * still refuses a typo as a typo, and does not reach the write path to find out. A refusal carries
 * no `status` -- it did not read, and a status here would be a claim about the seam made without
 * asking it.
 */
async function dispatch(
  request: unknown,
  writes: ChannelWrites | undefined,
  isClosed: () => boolean,
): Promise<CommandOutcome> {
  if (isClosed()) return { ok: false, reason: COMMAND_CLOSED }
  const fields = request !== null && typeof request === 'object'
    ? (request as Record<string, unknown>)
    : undefined
  const name = fields === undefined ? undefined : fields[COMMAND_NAME]
  if (typeof name !== 'string' || !SAVE_OR_FORGET.includes(name)) {
    return { ok: false, reason: COMMAND_UNKNOWN }
  }
  if (writes === undefined) return { ok: false, reason: COMMAND_NO_WRITES }
  if (name === 'forget') return await writes.forget()
  // The key text is passed through as the store will see it: this layer validates the name, not
  // the value, and key-store.ts is where docs/02 section 1.2 and 1.9 decide what a key may be.
  const key = fields === undefined ? undefined : fields[COMMAND_KEY]
  if (typeof key !== 'string') return { ok: false, reason: COMMAND_MALFORMED }
  return await writes.save(key)
}

/**
 * Opens the channel and returns the handle.
 *
 * The window key is installed before this returns, so the browser half always has something
 * to call -- even if the first publish() has not happened yet, view() builds a snapshot on
 * demand.
 */
export function openChannel(options: OpenChannelOptions): ChannelHandle {
  const target: ChannelTarget = options.target === undefined ? globalTarget() : options.target
  const pointsProviderId: ProviderId | null = options.pointsProviderId === undefined
    ? null
    : options.pointsProviderId

  const subscribers = new Set<(view: IconView) => void>()
  let writes = options.writes
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
    command(request: unknown): Promise<CommandOutcome> {
      return dispatch(request, writes, () => closed)
    },
    offer(next: ChannelWrites): void {
      if (closed) return
      writes = next
    },
  }

  target.write(CHANNEL_KEY, channel)

  return {
    command(request: unknown): Promise<CommandOutcome> {
      return dispatch(request, writes, () => closed)
    },
    offer(next: ChannelWrites): void {
      if (closed) return
      writes = next
    },
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
      target.write(CHANNEL_KEY, undefined)
      last = null
    },
  }
}
