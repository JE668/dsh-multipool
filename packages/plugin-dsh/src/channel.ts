/**
 * The host side of the left-bar icon (docs/05 section 2.3, T-2-b).
 *
 * The browser half runs in the page's module table and cannot call into this process, so what
 * it reads is whatever publish() last built. Nothing else crosses: not the key store, not the
 * scheduler, not the proxy -- except a command, which is one of the two endpoints in here and
 * only runs when the page asks for it (T-2-e).
 *
 * The view reaches the page over two `window` events agreed on below, not over a window key.
 *
 * Two earlier designs were tried and both failed in the same place. A key failed because the two
 * halves are two processes unrestrained by anything but hope: the host wrote, the page read
 * nothing, and every test passed because a test hands both halves one global. `connection.rpc`
 * (dsh-client-connection) then failed because the browser half provides that service only inside
 * DSH's own client bundle, not to a plugin loaded from a profile -- no `connection` on the page,
 * `ctx.inject(['connection'], ...)` never called back, and the icon drew dashes while the host it
 * could not reach was running fine.
 *
 * What is left is the window both halves demonstrably share in DSH desktop, which is the
 * renderer's. The cost is stated here rather than discovered later: a window event carries no
 * authentication, so this is a same-process conversation, and any script already running on the
 * page could answer in the host's place. Nothing in this file claims otherwise (docs/09).
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
 * The two window events the halves talk over.
 *
 * `page` is what the page dispatches and the host listens for; `host` is the answer, and it names
 * the side that sends it rather than the side that receives it, so neither name has to be read
 * from the other's point of view. Both are namespaced under `dsh-multipool:` because a window
 * event bus is shared with every other plugin in the profile, and an unprefixed name is a
 * collision waiting for the second plugin to be written.
 *
 * The payload rule is the same one the view itself follows (docs/03): what travels is JSON, never
 * a function, a class instance, or a live handle. Each event names its endpoint (see
 * ENDPOINT_SNAPSHOT and ENDPOINT_COMMAND), so a third endpoint is one more string here and one
 * more branch in dispatch(), not a second event pair to keep in sync.
 */
export const BRIDGE_EVENT = 'dsh-multipool:bridge'
export const BRIDGE_REPLY = 'dsh-multipool:bridge-reply'

/**
 * The endpoint names the page may ask for over BRIDGE_EVENT.
 *
 * These used to be RPC endpoint names under CHANNEL = '/multipool'. They keep their spelling so the
 * two halves of this repo still speak one vocabulary, and they are now the only part of the
 * request the host trusts before it has looked at the payload.
 */
export const ENDPOINT_SNAPSHOT = 'snapshot'
export const ENDPOINT_COMMAND = 'command'

/**
 * What the browser half asks for. The page dispatches BRIDGE_EVENT with one of these and listens on
 * BRIDGE_REPLY for the matching callId.
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

/** The fields a bridge request carries. Anything else on the object is ignored, not merged. */
const BRIDGE_CALL = 'callId'
const BRIDGE_ENDPOINT = 'endpoint'
const BRIDGE_PAYLOAD = 'payload'

/** The shape BRIDGE_REPLY sends back: the endpoint's answer, plus which call it answers. */
export interface BridgeReply {
  readonly callId: string
  readonly ok: boolean
  readonly value?: unknown
  readonly error?: { readonly code: string; readonly message: string }
}

/** One bridge call answered, before it is given a callId. The same envelope as BridgeReply. */
export type BridgeAnswer =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/**
 * A minimal window: one listener to add, one event to dispatch-back, and nothing else.
 *
 * Written out instead of taking the DOM's Window so a test can hand over a plain object and the
 * host half never needs a browser to typecheck. In DSH the real value is `globalThis`.
 */
export interface BridgeTarget {
  addEventListener(type: string, listener: (event: unknown) => void): unknown
  removeEventListener(type: string, listener: (event: unknown) => void): unknown
  dispatchEvent(event: { readonly type: string; readonly detail?: unknown }): unknown
}

/**
 * The dispatchEvent is specified to refuse anything that is not an Event, which a browser enforces
 * with "parameter 1 is not of type 'Event'". A plain object literal therefore only ever works where
 * the callback never reached a real platform -- the same shape as the two failures in docs/09
 * section 6.1.1, green in test and silent in the app. So the answer is wrapped in whichever event
 * constructor the running platform actually has: a browser has CustomEvent (detail is a real
 * member), Node has Event (detail becomes an own property, which is all readBridgeRequest reads).
 *
 * A platform with neither cannot dispatch at all, and the caller finds that out at once.
 */
type EventCtor = new (type: string, init?: { readonly detail?: unknown }) => { readonly type: string; readonly detail?: unknown }

function eventCtor(): EventCtor | undefined {
  const global = globalThis as {
    readonly CustomEvent?: EventCtor
    readonly Event?: EventCtor
  }
  return global.CustomEvent ?? global.Event ?? undefined
}

function replyOn(where: BridgeTarget, wire: BridgeReply): void {
  const Ctor = eventCtor()
  if (Ctor === undefined) return
  where.dispatchEvent(new Ctor(BRIDGE_REPLY, { detail: wire }))
}

/**
 * The endpoint table: one JSON payload per endpoint name, one JSON answer.
 *
 * `payload` arrives already parsed out of the event. Both endpoints answer in the envelope the
 * page parses -- { ok, value } or { ok: false, error } -- and no answer may carry a function, a
 * class instance, or a live handle (that is what KeyReading rather than KeyStatus is for below).
 *
 * An unknown endpoint is refused by name. Rule 3 one level up: the set of endpoints is the whole
 * surface a page can reach, so it stays a list somebody reads.
 */
export function answerOf(
  handle: ChannelHandle,
): (endpoint: string, payload: unknown) => Promise<BridgeAnswer> {
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

/** What a bridge request says, once its shape has been checked and nothing has been assumed. */
export interface BridgeRequest {
  readonly callId: string
  readonly endpoint: string
  readonly payload: unknown
}

/**
 * Reads one BRIDGE_EVENT detail, or nothing when this event is not ours.
 *
 * Kept apart from the listener so a test can hand it a plain object and never touch a window. A
 * detail with no string callId or no string endpoint is not a malformed request to refuse -- it is
 * somebody else's event, or a stray dispatch with no fields, and the ordinary answer to both is to
 * not answer.
 */
export function readBridgeRequest(detail: unknown): BridgeRequest | undefined {
  if (detail === null || typeof detail !== 'object') return undefined
  const fields = detail as Record<string, unknown>
  const callId = fields[BRIDGE_CALL]
  const endpoint = fields[BRIDGE_ENDPOINT]
  if (typeof callId !== 'string' || callId === '') return undefined
  if (typeof endpoint !== 'string' || endpoint === '') return undefined
  return { callId, endpoint, payload: fields[BRIDGE_PAYLOAD] }
}

/**
 * The window both halves share, or undefined where there is none.
 *
 * `globalThis.window`, never `globalThis`. Inside Electron both globals exist, and nothing about one
 * says anything about the other: a plugin loaded in a process whose `globalThis` is not the page's
 * gets an object on which addEventListener is simply absent. That is the failure a real install
 * reported -- "where.addEventListener is not a function" -- and it killed the entry before apply()
 * could return a disposer, so the plugin vanished from the rail with no warning, because this plugin
 * is not in boot's required set and a pending entry only draws a console line.
 *
 * Same shape as the two in docs/09 section 6.1.1: naming an object by what the test allows instead of
 * by what the platform guarantees. A test's stub can be a window; a host process's globalThis cannot
 * be made to be one.
 *
 * So the name is checked, and then the two methods this file actually calls are checked. A globalThis
 * can be shaped differently in every host process -- including one where `window` exists as an object
 * without an EventTarget on it -- and the useful question is never "is there a window" but "can this
 * one be listened on and dispatched to".
 */
function globalBridge(): BridgeTarget | undefined {
  const here = globalThis as { readonly window?: unknown }
  const maybe = here.window
  if (maybe === null || maybe === undefined || typeof maybe !== 'object') return undefined
  const target = maybe as { readonly addEventListener?: unknown; readonly dispatchEvent?: unknown }
  if (typeof target.addEventListener !== 'function') return undefined
  if (typeof target.dispatchEvent !== 'function') return undefined
  return maybe as BridgeTarget
}

/**
 * Wires BRIDGE_EVENT on `target` to `handle`, and sends each answer back on BRIDGE_REPLY.
 *
 * The two events are how the halves reach each other now. The page dispatches one; this process
 * listens, answers, and dispatches the other with the caller's own callId, so two requests in
 * flight cannot swap answers. `target` is `globalThis` in DSH, where host and page are the same
 * Electron renderer -- which is also the whole reason there is no authentication here (docs/09).
 *
 * The returned disposer removes the listener, and is what makes a disable leave nothing behind on
 * the bus: the same promise route registration made, now checkable without a web server.
 */
export function bridgeOf(
  handle: ChannelHandle,
  target: BridgeTarget | undefined = undefined,
): () => void {
  // The default is resolved here rather than in the parameter list: an explicit undefined --
  // which is what options.target is when a host passes no window -- would wipe out a default.
  const where = target === undefined ? globalBridge() : target
  // No window, no listener -- and saying so by doing nothing rather than by throwing. A host
  // with no bus to attach to is the same shape as one with no carrier: the icon must still paint,
  // and a throw from apply() removes the entry from the page entirely (docs/09 section 6.1).
  if (where === undefined) return () => undefined
  const answer = answerOf(handle)
  const onRequest = (event: unknown): void => {
    const request = readBridgeRequest(
      event !== null && typeof event === 'object'
        ? (event as Record<string, unknown>).detail
        : undefined,
    )
    if (request === undefined) return
    answer(request.endpoint, request.payload).then(
      (reply) => {
        const wire: BridgeReply = reply.ok
          ? { callId: request.callId, ok: true, value: reply.value }
          : { callId: request.callId, ok: false, error: reply.error }
        replyOn(where, wire)
      },
      (thrown: unknown) => {
        // An endpoint that threw still owes the caller an answer, or the page waits forever for a
        // callId that will never come back. The message is the throw's own, not a rewrite of it.
        replyOn(where, {
          callId: request.callId,
          ok: false,
          error: {
            code: 'multipool/endpoint-threw',
            message: thrown instanceof Error ? thrown.message : String(thrown),
          },
        })
      },
    )
  }
  where.addEventListener(BRIDGE_EVENT, onRequest)
  return () => {
    where.removeEventListener(BRIDGE_EVENT, onRequest)
  }
}
