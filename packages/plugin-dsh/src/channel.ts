/**
 * The host side of the left-bar icon (docs/05 section 2.3, T-2-b).
 *
 * The browser half runs in the page's module table and cannot call into this process, so what
 * it reads is whatever publish() last built. Nothing else crosses: not the key store, not the
 * scheduler, not the proxy -- except a command, which is one of the two endpoints in here and
 * only runs when the page asks for it (T-2-e).
 *
 * The view reaches the page as an HTTP route under CHANNEL, served by this process's web server.
 *
 * Three earlier designs were tried and all three failed in the same place: each assumed the two
 * halves share something that an application process can only be lent. A window key assumed one
 * global. `connection.rpc` assumed a service the browser half receives, and DSH provides that one
 * only inside its own client bundle, not to a plugin a profile loads. Window events assumed one
 * window -- and dispatchEvent did fire on the renderer's, into a bus this Node process was never
 * subscribed to, so the page reported "6 dispatch returned ; no reply in 4000ms".
 *
 * An HTTP route assumes neither. The page asks for it the way DSH desktop's own shell asks for
 * everything: dsh-app://app/<path> is handed by protocol.handle to forwardWebRequest, which
 * reissues the request against this web server with the Host's own cookie attached, and only for
 * the main frame's origin. The authentication is that cookie, checked by ctx.connection.admit
 * before the route is reached, so this file authenticates nothing and stores nothing -- the same
 * promise credentials.ts makes in its first rule. What it does not get is a push channel: a page
 * asks, and the answer stands until the page asks again.
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
 * The path prefix the page asks under, and the two endpoints below it.
 *
 * One segment, no dots and no blanks, because it is also what the renderer spells in a URL and what
 * a second plugin would have to avoid picking. The web server refuses a duplicate prefix outright,
 * so the collision this name could cause is a startup error with a message, not a request answered
 * by the wrong plugin.
 *
 * The payload rule is the one the view itself follows (docs/03): what travels is JSON, never a
 * function, a class instance, or a live handle. Each endpoint names itself in the path (see
 * ENDPOINT_SNAPSHOT and ENDPOINT_COMMAND), so a third endpoint is one more string here and one more
 * branch in answerOf(), not a second event pair to keep in sync.
 */
export const CHANNEL = '/dsh-multipool'

/**
 * The endpoint names the page may ask for, one path segment under CHANNEL.
 *
 * These have kept their spelling across four transports, so the two halves of this repo still speak
 * one vocabulary; and they are the only part of the request the host trusts before it has looked at
 * the payload.
 */
export const ENDPOINT_SNAPSHOT = 'snapshot'
export const ENDPOINT_COMMAND = 'command'

/**
 * What the browser half asks for. A page POSTs to CHANNEL/<endpoint> and reads the answer as JSON.
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
 * The endpoint table: one JSON payload per endpoint name, one JSON answer.
 *
 * `payload` arrives already parsed out of a request body. Both endpoints answer in the envelope the
 * page parses -- { ok, value } or { ok: false, error } -- and no answer may carry a function, a class
 * instance, or a live handle (that is what KeyReading rather than KeyStatus is for below).
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
      const request =
        payload !== null && typeof payload === 'object'
          ? (payload as Record<string, unknown>).request
          : undefined
      return { ok: true as const, value: await handle.command(request) }
    }
    return {
      ok: false as const,
      error: {
        code: 'multipool/unknown-endpoint',
        message: `no endpoint ${JSON.stringify(endpoint)}`,
      },
    }
  }
}

/** One endpoint answered, before it is given a status. The envelope answerOf returns. */
export type BridgeAnswer =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/**
 * The part of a Node http request this route reads.
 *
 * Structural rather than node:http's IncomingMessage: the web server passes real ones, a test
 * passes four lines, and this file then never depends on a transport's types to say what it uses.
 */
export interface BridgeRequest {
  readonly method?: string | undefined
  readonly url?: string | undefined
  [Symbol.asyncIterator](): AsyncIterator<unknown>
}

/** The part of a Node http response this route writes. */
export interface BridgeResponse {
  writeHead(status: number, headers?: Readonly<Record<string, string>>): unknown
  end(body?: string): unknown
}

/** A Route's handler takes Node's request and response, which is the read and the write above. */
export interface Route {
  readonly kind: 'prefix'
  readonly path: string
  readonly handler: (req: BridgeRequest, res: BridgeResponse) => unknown
}

/** What a web server has to offer to be claimable here: one prefix, and that claim back. */
export interface RouteServer {
  register(route: Route): () => void
}

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
} as const

/** The most request body this route will read, in bytes. A command is a name and a key. */
const MAX_BODY_BYTES = 64 * 1024

/**
 * Reads one request body as UTF-8, or undefined when it cannot be read at all.
 *
 * `undefined` means the body was unreadable -- too big, or an aborted request -- and is deliberately
 * not the same answer as a body that was read and happens not to be JSON. The caller sends 413 or 400
 * for the first and a repairable "malformed command" for the second, and that difference is the whole
 * difference between a page that can retry and one that cannot.
 */
async function readBody(req: BridgeRequest): Promise<string | undefined> {
  const parts: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    size += buffer.byteLength
    if (size > MAX_BODY_BYTES) return undefined
    parts.push(buffer)
  }
  return Buffer.concat(parts).toString('utf8')
}

/**
 * The web route: POSTs to the two endpoints, JSON in and JSON out.
 *
 * Only POST is answered. A GET is told the method exists and is elsewhere (Allow), rather than being
 * handed a snapshot a link could have prefetched or a cache could have kept: both endpoints speak
 * about this moment in the pool, and this moment has no address. The route is one prefix rather than
 * two exact entries so a third endpoint is a string in this file and a branch in answerOf(), not a
 * second registration somebody has to keep in step with the first.
 *
 * Nothing is read from the cookie here and nothing is set on it. `ctx.connection.admit` has already
 * decided whether the caller reaches a route at all, before this handler is called.
 */
export function routeOf(handle: ChannelHandle): Route {
  const answer = answerOf(handle)
  return {
    kind: 'prefix',
    path: CHANNEL,
    handler: async (req: BridgeRequest, res: BridgeResponse) => {
      const method = req.method ?? ''
      if (method !== 'POST') {
        // HEAD is answered like GET with an empty body: a caller checking reachability should not
        // have to read a body it was told not to expect.
        res.writeHead(405, {
          'allow': 'POST',
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'no-store',
        })
        res.end(method === 'HEAD' ? undefined : 'method not allowed; use POST\n')
        return
      }
      const endpoint = endpointFrom(req.url)
      const body = await readBody(req)
      if (body === undefined) {
        res.writeHead(413, {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'no-store',
        })
        res.end('request body too large or aborted\n')
        return
      }
      // An empty body is the one endpoint that takes no argument, so it is not a parse failure.
      let payload: unknown = undefined
      if (body !== '') {
        try {
          payload = JSON.parse(body)
        } catch {
          res.writeHead(400, {
            'content-type': 'text/plain; charset=utf-8',
            'cache-control': 'no-store',
          })
          res.end('request body is not JSON\n')
          return
        }
      }
      const reply = await answer(endpoint, payload)
      res.writeHead(200, JSON_HEADERS)
      res.end(JSON.stringify(reply))
    },
  }
}

/**
 * The endpoint name in a request path, or the empty string when the path is not one of ours.
 *
 * `?` and `#` both end the name here: the URL parser is not called, because this string is one the
 * web server has already matched a prefix against, and what is left is the part it did not.
 *
 * The two cuts are spelled out rather than written as `slice(0, url.indexOf('?'))`, because
 * `indexOf` answers -1 when neither is present and `slice(0, -1)` silently drops the last
 * character -- turning `/dsh-multipool/snapshot` into `snapsho`, which is a name this file has never
 * heard of. That is the same shape as every other failure in docs/09: correct-looking, quiet,
 * and only wrong on the branch the tests did not take.
 */
function endpointFrom(url: string | undefined): string {
  if (typeof url !== 'string') return ''
  const prefix = CHANNEL + '/'
  const query = url.indexOf('?')
  const fragment = url.indexOf('#')
  let tail = url
  if (query !== -1) tail = tail.slice(0, query)
  if (fragment !== -1) tail = tail.slice(0, fragment)
  if (!tail.startsWith(prefix)) return ''
  const name = tail.slice(prefix.length)
  // A second slash is not a shorter name for this endpoint; it is a different path, refused below.
  return name.includes('/') ? '' : name
}

/**
 * Claims the route and returns the disposer, or a disposer with nothing claimed.
 *
 * No web server means no route and nothing thrown: the same shape bridgeOf took for a missing window.
 * apply() has to return a disposer either way, and an entry that throws is an entry DSH removes from
 * the page with only a console line left behind (docs/09 section 6.1).
 */
export function serveOn(server: RouteServer | undefined, handle: ChannelHandle): () => void {
  if (server === undefined) return () => undefined
  return server.register(routeOf(handle))
}
