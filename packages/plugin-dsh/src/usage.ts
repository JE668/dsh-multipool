/**
 * The one place this plugin asks AMD for a number (docs/06 T-2-f; docs/02 section 1.5).
 *
 * What it asks for is `GET /v1/usage?include_recent=true` -- the endpoint 02 section 1.5 says to
 * read your own limits from, and the only one whose fields are a tally rather than a charge. It
 * sends nothing else: no prompt, no model, no completion. So a call here consumes zero pts, which
 * is the whole reason a settings form may do it at the press of a button while the proxy it fronts
 * keeps refusing to measure anything by asking.
 *
 * It is not budgeted either, and that is deliberate rather than an oversight. docs/04 counts a
 * request against rpmAccount because the account shares a window with clients this plugin cannot
 * see; a usage read is this plugin looking at its own book, once, because the reader pressed a key.
 * It never happens on a timer (see docs/05 section 4.3: a panel that polls has become a client), so
 * there is no cadence to fold into a budget -- only a person's click, which the 60-second floor in
 * core/amd-usage.ts already bounds.
 *
 * Who sends it: this process, not the seam. `ctx.credentials` answers four questions -- resolve,
 * describe, set, unset -- and sending a request is not one of them. For one round this file asked
 * `seam.fetch` and a missing member was read as "the host cannot ask", which was a sentence about
 * our own wish dressed as a fact about DSH. `resolve` answers the value; attaching it is this
 * module's job, and the whole job ends inside `sendOnce` below: nothing here logs, stores, or
 * reports the value, and the sentences that leave carry the status line instead.
 */

import {
  USAGE_POLL_FLOOR_MS,
  parseUsageResponse,
  PROVIDER_BASE_URLS,
  scrubSecrets,
  type ProviderId,
  type UsageResult,
} from '@dsh-multipool/core'
import type { CredentialSeam } from './key-store.js'
import type { DiagnoseResult } from './source.js'

/** Where the upstream usage reading answers, and how it is spelled when it does not. */
export const USAGE_PATH = '/usage?include_recent=true'

/** One probe request: POST the smallest possible chat body to read the account's own rate headers. */
export const DIAGNOSE_PATH = '/v1/chat/completions'

/** One frame of a probe answer: status, headers, body -- nothing else touches the key. */
export interface ProbeFrame {
  readonly status: number
  readonly headers: Readonly<Record<string, string>>
  readonly body: string
}

/** Send one POST to `url` with `Authorization: Bearer <key>` and a JSON body, returning only the frame.
 *
 * The key never leaves this function: not returned, not logged, not put into a thrown error.
 * `fetch` is looked up per call so a test can replace `globalThis.fetch`.
 */
async function sendProbe(
  url: string,
  key: string,
  body: unknown,
  timeoutMs: number,
): Promise<ProbeFrame> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body === undefined ? null : body),
      signal: controller.signal,
    })
    const headers: Record<string, string> = {}
    response.headers.forEach((value, name) => {
      headers[name.toLowerCase()] = value
    })
    const bodyText = await response.text()
    return { status: response.status, headers, body: bodyText }
  } catch (error) {
    const reason = controller.signal.aborted ? 'timed out after ' + String(timeoutMs) + 'ms' : 'no answer'
    throw new Error(reason + ' from ' + scrubSecrets(url.replace(/\?.*$/, '')))
  } finally {
    clearTimeout(timer)
  }
}

/** One press of the settings-page "account summary diagnosis" button (T-1-i).
 *
 * Read-only: one POST to the upstream chat endpoint with max_tokens: 1, then report the
 * rate-limit headers it answered with. Writes nothing -- not the key, not any budget field,
 * not the metrics store. The request is real traffic, so it counts against the account's
 * 20 RPM window like any other chat request; this plugin grants it no exemption.
 */
export async function diagnoseAmd(args: {
  readonly providerId: ProviderId
  readonly seam: CredentialSeam | undefined
  readonly reference: string
  readonly baseUrl?: string
  readonly nowMs: number
  readonly lastAttemptMs?: number
  readonly timeoutMs?: number
  /** The layer the seam resolved the key in, if it named one. Travels out on the attempt. */
  readonly layer?: string
}): Promise<DiagnoseResult> {
  const now = args.nowMs
  const floor = args.timeoutMs === undefined ? 60_000 : args.timeoutMs
  if (args.lastAttemptMs !== undefined && now - args.lastAttemptMs < floor) {
    return {
      providerId: args.providerId,
      upstreamLimit: null,
      upstreamRemaining: null,
      status: null,
      said: 'the previous probe is less than a minute old, and the upstream allows one a minute',
      atMs: now,
      tooSoon: true,
    }
  }

  const base = args.baseUrl ?? PROVIDER_BASE_URLS.amd ?? ''
  const seam = args.seam
  if (seam === undefined) {
    return {
      providerId: args.providerId,
      upstreamLimit: null,
      upstreamRemaining: null,
      status: null,
      said: 'no ' + args.reference + ' is stored, so there was nothing to send',
      atMs: now,
      tooSoon: false,
    }
  }
  const stored = await seam.resolve(args.reference)
  if (stored === undefined) {
    return {
      providerId: args.providerId,
      upstreamLimit: null,
      upstreamRemaining: null,
      status: null,
      said: 'no ' + args.reference + ' is stored, so there was nothing to send',
      atMs: now,
      tooSoon: false,
    }
  }

  const url = base.replace(/\/$/, '') + DIAGNOSE_PATH
  let frame: ProbeFrame
  try {
    frame = await sendProbe(url, stored.value, { max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }, args.timeoutMs ?? 15_000)
  } catch (error) {
    return {
      providerId: args.providerId,
      upstreamLimit: null,
      upstreamRemaining: null,
      status: null,
      said: 'upstream unreachable: ' + scrubSecrets(error instanceof Error ? error.message : String(error)),
      atMs: now,
      tooSoon: false,
    }
  }

  const limitRaw = frame.headers['x-ratelimit-limit-user-rpm']
  const remainingRaw = frame.headers['x-ratelimit-remaining-user-rpm']
  const limit = limitRaw === undefined ? null : Number(limitRaw)
  const remaining = remainingRaw === undefined ? null : Number(remainingRaw)
  const said = frame.status < 200 || frame.status >= 300
    ? 'HTTP ' + String(frame.status) + (frame.body === '' ? '' : ': ' + firstLineOf(frame.body, 160))
    : 'the upstream answered ' + String(frame.status) + ' and reported its own rate headers'
  return {
    providerId: args.providerId,
    upstreamLimit: limit,
    upstreamRemaining: remaining,
    status: frame.status,
    said: scrubSecrets(said),
    atMs: now,
    tooSoon: false,
    ...(args.layer === undefined ? {} : { layer: args.layer }),
  }
}

/** One frame of a reading: the JSON text, or the status line when the text is not the answer. */
export interface UsageFrame {
  readonly status: number
  readonly body: string
}

/** Wait no longer than this for the upstream; a form must not hang on a stalled socket. */
export const USAGE_TIMEOUT_MS = 15000

/**
 * Send one GET to `url` with `Authorization: Bearer <key>`, and hand back only the frame.
 *
 * The key is a parameter here and nowhere else: it is not returned, not logged, and not put into
 * the thrown error -- an HTTP client that quotes the request headers in a failure message would
 * turn a network fault into a key leak, so the catch below rebuilds the sentence from the URL alone
 * (scrubbed) and says nothing about what was attached.
 *
 * `fetch` is looked up per call rather than captured at import: Node 18+ exposes it globally, replied,
 * and a test replaces `globalThis.fetch` to answer without a socket.
 */
async function sendOnce(
  url: string,
  key: string,
  timeoutMs: number,
): Promise<{ readonly status: number; readonly body: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { authorization: 'Bearer ' + key, accept: 'application/json' },
      signal: controller.signal,
    })
    const body = await response.text()
    return { status: response.status, body }
  } catch (error) {
    // Abort and transport faults merge into one sentence on purpose: from the form both mean
    // "nothing came back", and the URL is the only part of this that is safe to repeat.
    const reason = controller.signal.aborted ? 'timed out after ' + String(timeoutMs) + 'ms' : 'no answer'
    throw new Error(reason + ' from ' + scrubSecrets(url.replace(/\?.*$/, '')))
  } finally {
    clearTimeout(timer)
  }
}

/**
 * How one provider's usage read travels: ask the seam for the value, then send it.
 *
 * Three failures stay three sentences, because they have three different fixes:
 *   - no seam at all: this DSH composed no credential provider (nothing to fill in);
 *   - seam says nothing is stored: the value is missing, not the transport (fill the field);
 *   - seam throws: the store itself is unwell, and its own words are scrubbed and passed through.
 * A seam that answers `undefined` is a reading too -- "absent" is what `keyStateOf` calls it -- and
 * saying "cannot make requests" for it would send the reader to look for the wrong problem.
 */
export function usageWire(
  seam: CredentialSeam | undefined,
  reference: string,
  timeoutMs: number,
): ((url: string) => Promise<UsageFrame>) | undefined {
  if (seam === undefined) return undefined
  return async (url: string): Promise<UsageFrame> => {
    const stored = await seam.resolve(reference)
    if (stored === undefined) {
      throw new Error('no ' + reference + ' is stored, so there was nothing to send')
    }
    const frame = await sendOnce(url, stored.value, timeoutMs)
    return { status: frame.status, body: frame.body }
  }
}

/** What a press of the test button produces edition: a reading, or the reason there is none. */
export interface UsageAttempt {
  /** Which provider was asked. Beside the answer so a form never has to remember what it pressed. */
  readonly providerId: ProviderId
  /** The reading, or null when no answer came back. Null and a zero reading are different answers. */
  readonly usage: UsageResult | null
  /** One sentence for the form. Never the key: `scrubSecrets` runs over everything here. */
  readonly said: string
  /** Epoch ms this attempt finished, so a second press inside a minute can be refused locally. */
  readonly atMs: number
  /**
   * True when no request was made because the last one was too recent, and `said` is the sentence
   * explaining which reading the answer is instead -- see the merge branch in readAmdUsage.
   */
  readonly tooSoon: boolean
  /**
   * True when `usage` is the previous reading carried forward rather than a new one: inside the
   * 60-second floor there is one request per minute, and a second press inside it gets that one
   * request's answer with a sentence that says so. A form may style it differently; it must not
   * print it as a fresh number (docs/07 U-06).
   */
  readonly carried?: boolean
  /**
   * Which layer the key was found in, when the seam named one.
   *
   * Only the seam knows, and it only answers on the read that found the key -- so the layer has
   * to travel on the reading or it cannot be shown at all without a second request for a fact
   * the first one already had. Absent when nothing is stored, or when the seam declined to name
   * a layer: an unnamed layer is not a guessable one (key-store.ts:94).
   */
  readonly layer?: string
}

/**
 * Fetch the account's usage once, and say what happened in words a form can print.
 *
 * Every branch is a different sentence because they are different facts: no seam at all, a seam
 * that cannot send, a non-2xx answer with the upstream's own words, a 2xx whose body is not the
 * shape we read, and finally a reading. Collapsing them into "failed" would be the same mistake
 * the icon's dashes were: one glyph for five things.
 */
export async function readAmdUsage(args: {
  readonly providerId: ProviderId
  readonly seam: CredentialSeam | undefined
  readonly reference: string
  readonly baseUrl?: string
  readonly nowMs: number
  readonly lastAttemptMs?: number
  readonly previous?: UsageResult
  readonly timeoutMs?: number
  /** The layer the seam resolved the key in, if it named one. Travels out on the attempt. */
  readonly layer?: string
}): Promise<UsageAttempt> {
  if (args.lastAttemptMs !== undefined && args.nowMs - args.lastAttemptMs < USAGE_POLL_FLOOR_MS) {
    // The floor is not a refusal any more (T-2-f): pressing again inside the minute answers with
    // the reading that minute already bought, and one sentence that says where it came from. Two
    // identical presses then read as one number twice instead of as a button that stopped working.
    if (args.previous === undefined) {
      return {
        providerId: args.providerId,
        usage: null,
        said: 'the previous read is less than a minute old, and the upstream allows one a minute',
        atMs: args.nowMs,
        tooSoon: true,
      }
    }
    return {
      providerId: args.providerId,
      usage: args.previous,
      ...(args.layer === undefined ? {} : { layer: args.layer }),
      // Carried, and it says so: the number on screen is real, the request behind it is not new.
      // A form that printed this as a fresh reading would turn one request into two in the reader's
      // head, which is the only currency docs/04 budgets in.
      said: 'carried from the read made less than a minute ago',
      atMs: args.nowMs,
      tooSoon: false,
      carried: true,
    }
  }

  const base = args.baseUrl ?? PROVIDER_BASE_URLS.amd ?? ''
  const wire = usageWire(args.seam, args.reference, args.timeoutMs ?? USAGE_TIMEOUT_MS)
  if (wire === undefined) {
    // One fact, one sentence: there is no credential seam on this host, so no key can be attached.
    return {
      providerId: args.providerId,
      usage: null,
      said: 'no credential service on this context, so nothing was asked upstream',
      atMs: args.nowMs,
      tooSoon: false,
    }
  }

  const url = base.replace(/\/$/, '') + USAGE_PATH
  let frame: UsageFrame
  try {
    frame = await wire(url)
  } catch (error) {
    // The transport's own words, scrubbed. sendOnce() already keeps the key out of them.
    return {
      providerId: args.providerId,
      usage: null,
      said: 'upstream unreachable: ' + scrubSecrets(error instanceof Error ? error.message : String(error)),
      atMs: args.nowMs,
      tooSoon: false,
    }
  }

  if (frame.status < 200 || frame.status >= 300) {
    // The status and the upstream's first line, not a summary: "401 Login required" tells the reader
    // their key is not attached, and any paraphrase of it would be this file guessing.
    const first = firstLineOf(frame.body, 160)
    const said = 'HTTP ' + String(frame.status) + (first === '' ? '' : ': ' + first)
    return { providerId: args.providerId, usage: null, said: scrubSecrets(said), atMs: args.nowMs, tooSoon: false }
  }

  const usage = parseUsageResponse(frame.body, new Date(args.nowMs).toISOString())
  if (usage.available !== true) {
    // A 2xx whose body did not parse keeps the previous reading behind it, the way core's poller does:
    // the old number is still what the account said, and its own timestamp says how old it is.
    const carried = args.previous === undefined ? null : { ...args.previous, available: false, reason: 'failed' as const }
    return {
      providerId: args.providerId,
      usage: carried,
      said: 'the upstream answered ' + String(frame.status) + ' but the body was not a usage reading',
      atMs: args.nowMs,
      tooSoon: false,
    }
  }
  return {
    providerId: args.providerId,
    usage,
    said: '',
    atMs: args.nowMs,
    tooSoon: false,
    layer: args.layer,
  }
}

/** Put one reading into the map the snapshot reads, or take the provider's entry out. */
export function withProviderUsage(
  usage: Readonly<Partial<Record<string, UsageResult | null>>> | undefined,
  providerId: string,
  reading: UsageResult | null,
): Readonly<Partial<Record<string, UsageResult | null>>> {
  const next: Partial<Record<string, UsageResult | null>> = { ...(usage ?? {}) }
  if (reading === null) {
    // Removed rather than set to null: `null` is the map's word for "there is no usage endpoint here",
    // and an attempt that failed is not that claim. Absent keeps the two apart.
    delete next[providerId]
    return next
  }
  next[providerId] = reading
  return next
}

/**
 * The upstream's own opening sentence, trimmed to something a form can hold.
 *
 * Collapsed whitespace and a hard cap rather than a parse: on an error the interesting part of a
 * body is the sentence the server chose, not a structure this plugin would have to guess at for
 * every provider. 160 characters is enough for "Login required" and long enough that a truncated
 * one still says which kind of refusal it was.
 */
function firstLineOf(body: string, cap: number): string {
  return body.replace(/\s+/g, ' ').trim().slice(0, cap)
}
