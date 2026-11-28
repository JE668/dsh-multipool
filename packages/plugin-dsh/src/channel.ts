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
  type DashboardReading,
  type MetricsEvent,
  type ProviderId,
  type Snapshot,
  type UsageResult,
  PROVIDER_BASE_URLS,
  USAGE_POLL_FLOOR_MS,
  parseUsageResponse,
  scrubSecrets,
} from '@dsh-multipool/core'
import { iconViewOf, type IconView } from '@dsh-multipool/plugin-client'
import type { UsageAttempt } from './usage.js'
import type { DiagnoseResult } from './source.js'

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
 * How far `accounts()` has been read, in the only three words that are true.
 *
 * `empty` is a reading and `unread` is not: the first says the pool was asked and holds nothing, the
 * second says nobody has asked. Only the first may print a number at all, and it prints zero.
 */
export type Reading = 'unread' | 'read' | 'empty'

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
 * Not an endpoint this repo's own page calls: the third is where a *prompt* would go, so the name is
 * taken here to mean "ask the upstream once, on purpose" and documented as such.
 */
export const ENDPOINT_TEST = 'test'

/**
 * T-3-a's dashboard reading, as opposed to T-2-f's pressed one.
 *
 * The same question asked by a timer instead of a person, so it gets its own name: a dashboard
 * that re-renders every few seconds must not be able to look like someone pressed Test, and a
 * press must not be told a poll is waiting. Both go through sources.readUsage and both sit under
 * the same sixty-second floor, because that floor belongs to the upstream, not to the surface
 * that happened to notice it.
 */
export const ENDPOINT_READING = 'reading'
/**
 * The dashboard's curve and table, in one answer (T-3-b).
 *
 * One endpoint rather than two because the two halves are one tick of one poll: split across two
 * names, a page could draw a curve at 10:31:02 and a table at 10:31:05 without either saying so, and
 * a reader comparing them would be comparing two moments while believing they saw one. The cost is
 * that a host must produce both or neither -- which it can, since both come from the same window.
 */
export const ENDPOINT_DASHBOARD = 'dashboard'
export const ENDPOINT_DIAGNOSE = 'diagnose'
/**
 * Field carrying which provider the test is about. Absent means the one the icon prints numbers for,
 * which today is the only provider with a usage endpoint.
 */
export const TEST_PROVIDER = 'providerId'
/**
 * Refused because this host was built without anything that can reach an upstream.
 *
 * Two codes, not one, because one sentence had been standing in for two different bugs: the page
 * was asking nobody (no ChannelSource reached answerOf, or it had no testUsage), and the page was
 * asking somebody who had no credential service to lend. The first is a wiring bug, the second is a
 * DSH build that provides no credentials -- and until they were separated, both printed identical words.
 */
export const NO_TEST_SOURCE = 'multipool/no-upstream'
/** Refused because the source exists and is wired, but it holds no seam to spend. */
export const NO_TEST_SEAM = 'multipool/no-credential-seam'

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
  /**
   * Whether `accounts()` is a reading at all, or only the list this source happens to hold.
   *
   * The two are indistinguishable by shape: an unread pool and a pool that was read and found empty
   * both answer `[]`, and the badge draws `0/0` for both. The first is not a claim the host may make
   * (U-06), so the difference travels as a third word rather than as a convention every painter has
   * to remember.
   */
  readonly reading: () => Reading
  /**
   * Which layer answered the key read, or nothing when nobody has read it yet.
   *
   * The settings page's one non-numeric line depends on this: "stored" alone is true of every
   * install and tells a reader nothing about whether their `.env` or their Keychain is what
   * answered. It rides beside `reading` for the same reason -- both are facts about the seam that
   * the accounts list cannot carry.
   */
  readonly keyLayer?: () => string | undefined
  /**
   * The upstream usage reading for this provider, asked for now (T-2-f's test button).
   *
   * Absent when nobody can ask: no seam, or a seam that only describes. One call puts at most one
   * request on the wire and charges at most that request's zero points; `tooSoon` says the call was
   * not even made because the last one was under the floor.
   */
  readonly testUsage?: (providerId: ProviderId) => Promise<UsageAttempt>
  /**
   * Ask the seam for the key now, and write what it says into these facts.
   *
   * Absent when the hook was never wired. Present, it is the only way the page can make the host
   * look: the alternative was a read on apply(), which paints a fresh install's icon with a
   * conclusion nobody asked for.
   */
  readonly readFromSeam?: () => Promise<boolean>
  /**
   * The same reading as testUsage, asked by a timer rather than a hand (T-3-a).
   *
   * A separate name because the two callers are separate promises: a poll inside the minute gets
   * the carried reading back (tooSoon false, carried true) rather than a refusal, so a dashboard
   * always has the last number it saw to draw. No new request, no new cost -- usage.ts decides that.
   */
  readonly readUsage?: (providerId: ProviderId) => Promise<UsageAttempt>
  /**
   * The dashboard's fold of the same events: an hour of minutes, plus the newest rows of them.
   *
   * Optional and separate from `events()` on purpose. `events()` is the raw window a snapshot counts;
   * this is the same window already bucketed and capped, because the page polls it every few seconds
   * and shipping the raw list would make each poll's size depend on how busy the account was. A host
   * with no metrics store simply has no member here, and the page draws its "nothing recorded yet"
   * state rather than a flat line at zero -- the two are different claims (docs/07 U-08).
   */
  readonly readDashboard?: () => DashboardReading
  /**
   * One account-summary probe: POST one minimal chat request to the upstream and report the
   * rate-limit headers it answered with (T-1-i). Read-only, never writes the store.
   */
  readonly diagnose?: (providerId: ProviderId) => Promise<DiagnoseResult>
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
export type ChannelCommandName = 'save' | 'forget' | 'reject-on-budget-exhausted'

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
  readonly layer?: string
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
  /**
   * Step 2 gate toggle: the page's settings section sets this, and the intercept layer
   * reads it on every AMD request. Absent on installs without a credential service, which
   * keeps the toggle invisible where there is nothing to gate.
   */
  readonly rejectOnBudgetExhausted?: (value: boolean) => Promise<CommandOutcome>
}

export interface PublishedView {
  readonly snapshot: Snapshot
  /** How far the accounts were read: 'unread' is not the same claim as 'empty'. */
  readonly reading: Reading
  readonly view: IconView
  /** The scrubbed JSON. Kept beside the view so a test can assert the wire carries no key. */
  readonly wire: string
  /** Which layer answered, absent when nobody has read the seam. Same reason as ChannelSource. */
  readonly layer?: string
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
  /**
   * The last published view, or null before the first publish.
   *
   * answerOf() asks through this so the page's snapshot request does not double as a command: a
   * question must not refresh the state the rest of the file is answering from.
   */
  readonly published: () => PublishedView | null
  readonly isPublished: () => boolean
  readonly command: (request: unknown) => Promise<CommandOutcome>
  /**
   * The source this handle was opened over, handed back so the route can be wired with it.
   *
   * It travels here rather than being passed alongside `openChannel({ source })` because the two
   * used to be separate arguments at separate call sites, and the second one was forgotten: the
   * route was registered without a source, so the test endpoint refused every press with "this host
   * cannot ask an upstream" while the host was in fact asking one every five seconds for the icon.
   * One object, one path -- the route takes the handle and reads the source off it.
   */
  readonly source: ChannelSource
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
  const reading = source.reading()
  const view = iconViewOf({ snapshot, budget, pointsProviderId, attached: true, reading })
  // The list and the claim about it travel together. serializeSnapshot() cannot carry this -- it
  // counts accounts, and a count of zero is the same number whether the pool was read or not.
  // Absent rather than undefined-valued: a channel with no seam is a shape without the member, and
  // spreading `{ keyLayer: undefined }` into every answer would make "cannot tell" look like "was
  // asked and said nothing" to a page that only checks for the key's presence.
  const layer = source.keyLayer === undefined ? undefined : source.keyLayer()
  return layer === undefined
    ? { snapshot, reading, view, wire: serializeSnapshot(snapshot) }
    : { snapshot, reading, view, layer, wire: serializeSnapshot(snapshot) }
}

/** The name a command request carries. One field, because there is one question. */
const COMMAND_NAME = 'name'
const COMMAND_KEY = 'key'
const COMMAND_VALUE = 'value'

/**
 * Every command name this channel answers -- the write ones, three of them.
 *
 * 'test' is deliberately not here. It is an endpoint of its own (ENDPOINT_TEST), answered by
 * answerOf() with the source in hand, because it is not a write and must keep working on an install
 * with no credential service at all. Adding it to this list once made { name: 'test' } stop being
 * "unknown command" and start being "test is not a write": a right sentence in the wrong mouth,
 * from a table that should never have learned the word.
 */
const KNOWN_COMMANDS: readonly string[] = ['save', 'forget', 'reject-on-budget-exhausted']

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
  if (typeof name !== 'string' || !KNOWN_COMMANDS.includes(name)) {
    return { ok: false, reason: COMMAND_UNKNOWN }
  }
  if (writes === undefined) return { ok: false, reason: COMMAND_NO_WRITES }
  if (name === 'forget') return await writes.forget()
  if (name === 'reject-on-budget-exhausted') {
    const value = fields === undefined ? undefined : fields[COMMAND_VALUE]
    if (typeof value !== 'boolean') return { ok: false, reason: COMMAND_MALFORMED }
    return await writes.rejectOnBudgetExhausted?.(value) ?? { ok: false, reason: COMMAND_NO_WRITES }
  }
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
    source: options.source,
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
    published(): PublishedView | null {
      return last
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
  source?: ChannelSource,
): (endpoint: string, payload: unknown) => Promise<BridgeAnswer> {
  return async (endpoint: string, payload: unknown) => {
    if (endpoint === ENDPOINT_SNAPSHOT) {
      const built = handle.publish()
      // The layer travels with the view, and only when there is one to send: a page that receives
      // `layer: undefined` cannot tell "no layer was reported" from "this host never reports layers",
      // and the second is a fact about a host nobody has met.
      return built.layer === undefined
        ? { ok: true as const, value: { view: built.view, reading: built.reading } }
        : { ok: true as const, value: { view: built.view, reading: built.reading, layer: built.layer } }
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
    if (endpoint === ENDPOINT_TEST && source !== undefined && source.testUsage !== undefined) {
      // The one endpoint that leaves this process and comes back with somebody else's words. The
      // words are spoken by the seam's holder, so this branch only decides which question to put to
      // it -- a provider id, or the one this channel prints numbers for.
      const asked =
        payload !== null && typeof payload === 'object'
          ? (payload as Record<string, unknown>)[TEST_PROVIDER]
          : undefined
      const providerId = typeof asked === 'string' && asked !== '' ? asked : 'amd'
      return { ok: true as const, value: await source.testUsage(providerId as ProviderId) }
    }
    if (endpoint === ENDPOINT_DASHBOARD && source !== undefined && source.readDashboard !== undefined) {
      // Both halves come out of one call, so they are one moment. The page may draw them slowly,
      // but it cannot be handed a curve from before the table it is comparing it with.
      return { ok: true as const, value: source.readDashboard() }
    }
    if (endpoint === ENDPOINT_DIAGNOSE && source !== undefined && source.diagnose !== undefined) {
      const asked =
        payload !== null && typeof payload === 'object'
          ? (payload as Record<string, unknown>)[TEST_PROVIDER]
          : undefined
      const providerId = typeof asked === 'string' && asked !== '' ? asked : 'amd'
      return { ok: true as const, value: await source.diagnose(providerId as ProviderId) }
    }
    if (endpoint === ENDPOINT_READING && source !== undefined && source.readUsage !== undefined) {
      const asked =
        payload !== null && typeof payload === 'object'
          ? (payload as Record<string, unknown>)[TEST_PROVIDER]
          : undefined
      const providerId = typeof asked === 'string' && asked !== '' ? asked : 'amd'
      return { ok: true as const, value: await source.readUsage(providerId as ProviderId) }
    }
    if (endpoint === ENDPOINT_READING) {
      // Its own refusal, and a different causal claim than the test one makes: readUsage missing
      // means the timer's door was never fitted, so nothing was asked -- and reading.ts is the only
      // caller, which is why this is still ok:false rather than a reading of null.
      if (source !== undefined) {
        return {
          ok: false as const,
          error: {
            code: NO_TEST_SEAM,
            message: 'this host has a source but no one in it can read an upstream',
          },
        }
      }
      return {
        ok: false as const,
        error: { code: NO_TEST_SOURCE, message: 'this host cannot read an upstream anything' },
      }
    }
    if (endpoint === ENDPOINT_TEST) {
      // Reached only when the wiring above declined to match. Which of the two it was is the whole
      // difference between a mistake in this file and a shape of the running install, so it is not
      // flattened into one sentence: a source that is there but silent means its testUsage was never
      // attached (a wiring bug); no source at all means this handle was opened without one.
      if (source !== undefined) {
        return {
          ok: false as const,
          error: {
            code: NO_TEST_SEAM,
            message: 'this host has a source but no one in it can ask an upstream',
          },
        }
      }
      return {
        ok: false as const,
        error: { code: NO_TEST_SOURCE, message: 'this host cannot ask an upstream anything' },
      }
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
export function routeOf(handle: ChannelHandle, source?: ChannelSource): Route {
  // The source is optional and only the test endpoint reads it: every other answer is built from
  // the handle. Passing it here rather than growing a second route keeps "the endpoints the page
  // can reach" a list in one function.
  const answer = answerOf(handle, source)
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
export function serveOn(
  server: RouteServer | undefined,
  handle: ChannelHandle,
  source?: ChannelSource,
): () => void {
  if (server === undefined) return () => undefined
  return server.register(routeOf(handle, source))
}
