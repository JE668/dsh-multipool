/**
 * The host side of the left-bar icon (docs/05 section 2.3, T-2-b).
 *
 * The browser half runs in the page's module table and cannot call into this process, so what
 * it reads is whatever publish() last built. Nothing else crosses: not the key store, not the
 * scheduler, not the proxy -- except a command, which is one of the two endpoints in here and
 * only runs when the page asks for it (T-2-e).
 *
 * The view reaches the page over `connection.rpc` (dsh-client-connection), not over a window
 * key. That key used to be the design: the host wrote a live object onto globalThis, and the
 * page read it. It could not work, because the two halves are two processes and globalThis is
 * one per process -- but the tests all passed, since a test hands both halves the same global.
 * An HTTP channel is what both processes can actually reach, and it brings the authentication
 * this file would otherwise have had to invent: `rpc.handle` admits, this module answers.
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
 *
 * One property is easy to lose here and was lost once already. Both endpoints return JSON, so
 * nothing on the wire may be a function or a live handle -- which is why CommandOutcome carries a
 * KeyReading and not the KeyStatus it was built from. A test that shares the same process cannot
 * notice the difference, so the shape is narrow on purpose.
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

/**
 * The RPC channel the page calls.
 *
 * One segment, and no slash inside it: dsh-client-connection tests a host channel against
 * /^\/[A-Za-z0-9._~-]+$/ and refuses the rest, reserving `/api` for the gateway it owns itself.
 * Rejected channel names fail at registration, so this constant is the only place the name is
 * spelled -- an endpoint below only ever appends one segment to it.
 */
export const CHANNEL = '/multipool'

/** The two endpoints `CHANNEL` serves; every other name is refused, see dispatch(). */
export const ENDPOINT_SNAPSHOT = 'snapshot'
export const ENDPOINT_COMMAND = 'command'

/**
 * What the browser half calls. Mirrors the shape client.js expects on
 * window.connection.rpc, reached as connection.rpc.call(CHANNEL, ENDPOINT_SNAPSHOT, {}).
 */
export interface Channel {
  /** ENDPOINT_SNAPSHOT: the current view, as it stands, JSON on the wire. */
  readonly view: () => IconView
  /**
   * ENDPOINT_COMMAND: ask the host to do one named thing.
   *
   * Its argument is `unknown` because the page is the one place a command arrives without having
   * been typed: a name this file has never heard of is a refusal, never a TypeError thrown into
   * the caller's click handler. The payload has crossed JSON by the time it gets here, so the
   * first thing dispatch() does is stop trusting its shape.
   */
  readonly command: (request: unknown) => Promise<CommandOutcome>
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
  /** Rebuild from current state and remember it. Returns what the next view() will answer. */
  readonly publish: () => PublishedView
  readonly isPublished: () => boolean
  readonly command: (request: unknown) => Promise<CommandOutcome>
  /** Attach the write half once the credential seam resolves. */
  readonly offer: (writes: ChannelWrites) => void
  /** Forget the last view. The channel is dead afterwards. */
  readonly close: () => void
}

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
 * Nothing is installed on the page here: `apply` closes over the handle and registers it with
 * `connection.rpc.handle`, which is the thing that admits a caller. This function only decides
 * what the two endpoints answer.
 */
export function openChannel(options: OpenChannelOptions): ChannelHandle {
  const pointsProviderId: ProviderId | null = options.pointsProviderId === undefined
    ? null
    : options.pointsProviderId

  let writes = options.writes
  let last: PublishedView | null = null
  let closed = false

  const build = (): PublishedView => buildPublishedView(options.source, options.budget, pointsProviderId)

  return {
    command(request: unknown): Promise<CommandOutcome> {
      return dispatch(request, writes, () => closed)
    },
    offer(next: ChannelWrites): void {
      if (closed) return
      writes = next
    },
    publish(): PublishedView {
      last = build()
      return last
    },
    isPublished(): boolean {
      return last !== null
    },
    close(): void {
      closed = true
      last = null
    },
  }
}

/**
 * The `connection.rpc.handle` callback: one JSON payload per endpoint name, one JSON answer.
 *
 * `handler` is handed the endpoint the caller asked for and a payload that is already plain JSON.
 * Both endpoints answer in the shape the transport on the other side parses -- { ok, value } or
 * { ok: false, error } -- and neither answer may carry a function, a class instance, or a live
 * handle.
 *
 * An unknown endpoint is refused by name. The same argument as rule 3 above applies one level up:
 * the set of endpoints is the whole surface a page can reach, so it stays a list somebody reads.
 */
export function handleOf(
  handle: ChannelHandle,
): (endpoint: string, payload: unknown) => Promise<
  { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }
> {
  return async (endpoint: string, payload: unknown) => {
    if (endpoint === ENDPOINT_SNAPSHOT) {
      return { ok: true as const, value: handle.publish().view }
    }
    if (endpoint === ENDPOINT_COMMAND) {
      // The payload is { request } rather than the request itself: a command with no fields
      // (`{}`) and a command that never arrived (`undefined`) then stay two different answers,
      // and dispatch() gets to decide which of them is malformed.
      const request = payload !== null && typeof payload === 'object'
        ? (payload as Record<string, unknown>).request
        : undefined
      return { ok: true as const, value: await handle.command(request) }
    }
    return {
      ok: false as const,
      error: { code: 'multipool/unknown-endpoint', message: `no endpoint ${JSON.stringify(endpoint)}` },
    }
  }
}
