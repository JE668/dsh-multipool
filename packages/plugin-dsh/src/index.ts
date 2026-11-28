/**
 * Host half of dsh-multipool.
 *
 * The plugin puts one window bridge (packages/plugin-dsh/src/channel.ts) in front of the page and
 * hands it the facts it has. Scheduling, the key store and the local proxy arrive in their own
 * tasks; until they do, those facts are "nothing has been read yet", which source.ts spells as
 * `undefined` rather than as zero.
 *
 * Entry points for the DSH loader:
 *
 * - No `inject` on purpose. `slots` lives in the browser half (dsh-cordis-client-runner), so
 *   naming it here parked this entry in "pending (waiting for service: slots)" forever -- the
 *   host fiber would never see it. `apply` reads nothing but `ctx.effect` and `ctx.inject`, which
 *   every context has.
 * - The bridge is `window` events, and asks for no service at all (T-2-b). It used to be
 *   `connection.rpc.handle` on a web route; that never activated, because `connection` is provided
 *   inside DSH's own client bundle and not to a plugin loaded from a profile, so the injection never
 *   called back and the icon dashed while the host was running fine. Two events need no provider.
 *   The trade is stated in docs/09: no authentication, so the page is trusted.
 * - `credentials` is asked for with `ctx.inject`, never listed in `inject`, and takes no part in
 *   whether this plugin activates (T-2-e). A key is what makes it able to send, not what makes it
 *   load: a DSH built without dsh-credentials-local (or with it disabled) must still show the icon,
 *   and the icon's honest answer there is "no credential service", not a refused plugin. The
 *   child's status is reported through `onKeyStatus` and nothing else in this file waits on it.
 * - `apply(ctx)` opens the channel and attaches the bridge listener inside `ctx.effect`, so
 *   disabling the plugin detaches it and leaves no listener behind, and publishing stays
 *   pull-based: `apply` opens, it does not publish. Nothing here schedules a timer of its own
 *   (docs/05 section 4.3).
 * - The clock is the injected one a caller passes in. This file never reads Date.now, so the
 *   icon's timestamps can be replayed exactly in a test that controls time (07 Z-03).
 */

import {
  DEFAULT_AMD_POLICY,
  USAGE_POLL_FLOOR_MS,
  computeBudget,
  createSystemClock,
  type Account,
  type ProviderId,
  type UsageResult,
  READING_MINUTES,
  READING_ROWS,
  rowsOf,
  trendOf,
} from '@dsh-multipool/core'
import {
  AMD_KEY_REF_NAME,
  openChannel,
  serveOn,
  CHANNEL,
  type ChannelSource,
  type ChannelWrites,
  type CommandOutcome,
  COMMAND_NO_WRITES,
  type IconBudget,
  type RouteServer,
} from './channel.js'
import {
  CREDENTIALS_SERVICE,
  readKeyStatus,
  clearKeyStatus,
  watchKeyStatus,
  writeKeyStatus,
  type KeyContext,
  type KeyStatus,
  type KeyWriteOutcome,
} from './credentials.js'
import type { CredentialSeam, KeyState } from './key-store.js'
import { NOTHING_READ, channelSourceFrom, type SourceFacts, type SourceHooks } from './source.js'
import { readAmdUsage, withProviderUsage, type UsageAttempt } from './usage.js'
import { createIntercept, type InterceptOptions, type InterceptHandle } from './intercept-index.js'

export const VERSION = '0.0.2-rc.4'

/**
 * The rail's second line is the account budget, and 04 section 2.2 says where that comes from:
 * computeBudget over the admission policy, not a constant this file keeps.
 *
 * It used to be 0 with an empty source list, and the page printed what it was given -- "global
 * RPM 0 (-)" on a machine that was serving. Zero is this module's most expensive possible default,
 * because it is the one number that reads as a measurement rather than as a missing value.
 *
 * headerRemaining is null: the response headers of a chat request are not visible to a plugin
 * loaded from a profile, so the 0.85 admission margin stands in for them, exactly as the gate's
 * own start-up state does. 02 section 1.3 still owns the reading, and 04 section 6.4 still says a
 * header can only lower this number.
 */
export const RAIL_BUDGET = computeBudget({ policy: DEFAULT_AMD_POLICY, headerRemaining: null })

export interface HostOptions {
  /** Facts to publish. Defaults to NOTHING_READ: no scheduler has run, so nothing is claimed. */
  readonly facts?: Parameters<typeof channelSourceFrom>[0]
  /** Read wall-clock milliseconds. Defaults to the system clock from core/clock.ts. */
  readonly nowMs?: () => number
  /**
   * Where the seam's answer goes. Called once when the plugin arms, and again after every
   * `credentials/reference-updated` that names this plugin's reference -- no other schedule exists.
   */
  readonly onKeyStatus?: (status: KeyStatus) => void
  /**
   * Offer the write half to the page's command() (T-2-e). On by default as of T-2-f.
   *
   * The settings page has shipped and the save button is real, so the write half is no longer a
   * promise about a surface that does not exist: docs/06 T-2-f asks for it to be on in the same
   * commit the button lands in, and this is the commit that decides it.
   *
   * Pass `false` to keep it off -- a test of a read-only install, or an embedder that vouches
   * for its own credentials and does not want this plugin holding a write path. The injection still
   * happens (the icon still needs it), it just carries no `writes` offer.
   */
  readonly acceptsWrites?: boolean
  /**
   * Step 2 gate: when true, a `tryAcquire` that returns `ok: false` causes the request
   * to be rejected outright (429-like response, no upstream call). Defaults to false --
   * step 1 is read-only: the gate is consulted and its budget observed, but nothing is
   * refused, nothing is delayed, nothing changes a routing decision.
   */
  readonly rejectOnBudgetExhausted?: boolean
  /**
   * The web server to claim CHANNEL on. Defaults to the `webServer` service, which is where DSH puts
   * it and where the page's dsh-app://app fetch already reaches.
   *
   * A test has no web server and should not need one: it passes four lines here -- a register that
   * keeps the route, and a disposer that drops it -- and then calls the route's handler with its own
   * request and response.
   */
  readonly server?: RouteServer
}

/** The store's answer, turned into what the page's command() hands back. */
function outcomeOf(result: KeyWriteOutcome): CommandOutcome {
  const status = result.status
  if (status.kind === 'read') {
    const state = status.state
    // The seam object is dropped here, not by the page: it is a live handle with four methods, and
    // the icon only ever needed to know whether a key is now there.
    const reading = state.kind === 'configured'
      ? { present: true, layer: state.layer }
      : { present: false }
    // "refused" and "unavailable" reach the page as their own words: one says the store answered with
    // an error, the other that there was no store to answer. Neither is the page's fault, and a form
    // that printed an unfilled field for either would be the mild lie this branch exists to avoid.
    return state.kind === 'configured'
      ? { ok: true, status: reading, message: result.message }
      : { ok: false, reason: state.kind, status: reading, message: result.message }
  }
  return { ok: false, reason: COMMAND_NO_WRITES, message: result.message }
}

const writesFor = (seam: CredentialSeam): ChannelWrites => ({
  save: (key: string) => writeKeyStatus({ credentials: seam }, key, AMD_KEY_REF_NAME).then(outcomeOf),
  forget: () => clearKeyStatus({ credentials: seam }, AMD_KEY_REF_NAME).then(outcomeOf),
})


/**
 * The service dsh-host-webserver registers. The namespaced package is the implementation; this is the
 * only spelling a context answers a get() for.
 */
export const WEB_SERVER_SERVICE = 'webServer'

/**
 * What an injection hands back: whichever of the named services the context has.
 *
 * Two are here. `credentials` carries the key (T-2-e), and `webServer` carries the route the page
 * reaches it by. Both are optional for the same reason: activate first, and say what is missing in
 * the icon, never in a throw that removes the entry from the page.
 */
interface InjectedServices {
  readonly credentials?: CredentialSeam
  readonly webServer?: RouteServer
}

/**
 * ctx.inject, or a no-op when the context predates the mixin.
 *
 * Both of apply()'s injections go through here, so "this DSH has no inject" stays one branch instead of
 * two, and a context that cannot inject is still a context the icon activates on.
 */
function injectOf(
  ctx: { inject?(names: string[], callback: (child: InjectedServices) => void): () => void },
  names: string[],
  callback: (child: InjectedServices) => void,
): () => void {
  const inject = ctx.inject
  if (typeof inject !== 'function') return () => undefined
  // A body that threw is caught here, and only here.
  //
  // Both injections run from inside the effect app-cordis runs to load this entry. inject() resolves
  // a *mock* when some of the names are absent, and a mock whose miss handler was not written yet
  // throws -- even from a property read this file never asked about, which is how a TypeError on
  // `target` took the whole entry down and the icon with it. The rule this file already states is
  // that the plugin must activate on a DSH with no carrier and draw dashes there; a dashed icon is
  // still an icon, but a throw is nothing at all, and the user sees the plugin disappear.
  //
  // Catching costs the route: where inject succeeds, handle() is registered and the icon answers.
  // Where it throws, there was no route to be had anyway, and the icon answers the dash -- the same
  // answer it gives on a DSH that predates connection. Silently, because a user cannot act on
  // "your other service's mock was incomplete".
  try {
    return inject.call(ctx, names, callback)
  } catch {
    return () => undefined
  }
}

/**
 * How far the pool has been read, in the source's own words.
 *
 * `SourceFacts` keeps each member optional, and that is enough for "one provider has no reading".
 * It is not enough for "nobody has read the pool yet" once `accounts ?? []` has turned the absence
 * into a list: from then on every count is a confident zero. So the third answer travels beside the
 * list instead of being inferred from it, and the badge prints a dash for it.
 */
export type MutableFacts = { -readonly [K in keyof SourceFacts]: SourceFacts[K] } & {
  reading?: 'unread' | 'read' | 'empty'
}

/**
 * The one account a single stored key amounts to.
 *
 * An empty list when the seam said there is no key: that is a reading too, and the icon draws 0/0
 * for it on purpose. `undefined` only when the state is not an answer about the pool at all --
 * `refused` and `unavailable` mean the question did not get through, and reporting "empty" on the
 * pool's behalf would be exactly the lie U-06 names.
 */
export function accountFrom(state: KeyState): readonly Account[] | undefined {
  if (state.kind === 'configured') {
    // Only the members an Account can carry without inventing any. No keyIdMasked: describe() never
    // returns a preview for env layers, and inventing one is the lie key-store.ts rule 3 prevents.
    return [
      {
        providerId: 'amd',
        accountAlias: AMD_KEY_REF_NAME,
        keyIdMasked: '',
        enabled: true,
        // Empty, not filled: nothing in this file has read the account's limits, and a number here
        // would be the plugin's own guess wearing an Account's clothes (docs/03).
        limits: {},
        status: 'available',
      },
    ]
  }
  if (state.kind === 'absent') return []
  return undefined
}

/**
 * Read the key now, keep reading it when the seam says the reference moved, and hand back one disposer.
 *
 * The disposer covers both halves, so a disabled plugin leaves nothing behind: no listener on the
 * seam's event, and no promise still writing into the facts object afterwards.
 *
 * The first read is not cached. key-store.ts resolves again on each operation, and a cached answer
 * here would freeze "the store said no" into the icon's first paint forever.
 */
export function reportKeyInto(
  context: KeyContext,
  facts: MutableFacts,
  onRead?: (status: KeyStatus) => void,
): () => void {
  const sink = onRead ?? ((): void => undefined)
  const apply = (status: KeyStatus): void => {
    if (status.kind !== 'read') return
    const accounts = accountFrom(status.state)
    if (accounts === undefined) return
    facts.accounts = accounts
    // The layer rides with the accounts, on the same answer and in the same assignment, because
    // the two are one reading: "there is a key" without "and it came from here" is what the page
    // used to print. `absent` keeps its own layer, which is none.
    facts.keyLayer = status.state.kind === 'configured' ? status.state.layer : undefined
    sink(status)
  }
  // watchKeyStatus() already reads once on its way in, so there is no separate first read here:
  // two would mean the seam is asked twice for one icon paint, and the second answer would be the
  // one that lands.
  return watchKeyStatus(context, apply)
}

/**
 * Ask the seam for the key right now, and write the answer where the next paint will find it (T-2-f).
 *
 * The page's settings section used to open with "no one has read this yet" and no way to stop being
 * that. This is that way, and it is the same three lines reportKeyInto() uses once the seam hands
 * its first answer: from the state, or undefined when the state is not an answer about the pool.
 *
 * Returns false for every answer that is not a reading. A form that printed "empty" over a refused
 * seam would be describing the store's health as the user's pool, which is the mistake U-06 names
 * one level up.
 */
async function readSeamNow(
  seam: CredentialSeam | undefined,
  facts: MutableFacts,
  onRead?: (status: KeyStatus) => void,
): Promise<boolean> {
  if (seam === undefined) return false
  const status = await readKeyStatus({ credentials: seam })
  if (status.kind !== 'read') return false
  const accounts = accountFrom(status.state)
  if (accounts === undefined) return false
  facts.accounts = accounts
  facts.keyLayer = status.state.kind === 'configured' ? status.state.layer : undefined
  if (status.state.kind !== 'configured') return false
  // Was there a key, or did the question fail? accountFrom() answers [] for `absent` -- "there is
  // no key" is a reading, and the settings page is right to print it -- but a request needs a
  // value, so a missing key is not a successful ask. The seam's own sentence still reaches the
  // page through onRead above; this line only decides whether the test endpoint got a reading.
  if (onRead !== undefined) onRead(status)
  return true
}

/**
 * One upstream reading, on the user's say-so (T-2-f).
 *
 * The floor is per provider and checked here rather than in usage.ts so the caller that remembers
 * the last attempt is the only thing that has to change: a form pressing twice in a second gets
 * `tooSoon` back and no request, which is what keeps a button from being an accidental poller.
 *
 * The reading goes into `facts.usage` only when one came back. A failed attempt leaves the map
 * exactly as it was: the old number is still what the account said, and its own `usageFetchedAt`
 * says how old it is. Overwriting it with an error would blank a true number into a blank page.
 */
async function askUsage(
  providerId: ProviderId,
  seam: CredentialSeam | undefined,
  nowMs: () => number,
  lastAttemptMs: () => number | undefined,
  stamp: (atMs: number) => void,
  facts?: MutableFacts,
  readFromSeam?: () => Promise<boolean>,
): Promise<UsageAttempt> {
  // Where the key is, asked before what it cost. The test button is the one surface that touches
  // both halves, so it is the one place a first press can learn the layer: resolve()/describe()
  // is a store read with no request behind it, it charges nothing, and it is not the number --
  // the 60-second floor below is about the number, and this must not borrow it.
  //
  // Read on every ask, not once and carried: a reading made inside the minute still names a place
  // for the page to print, and the store is the only thing that can say where that place is now.
  // Caching it would print yesterday's location beside today's number -- the same slide into "a
  // fact about the number" that the two refusals above were split to avoid.
  const stale = lastAttemptMs()
  const insideFloor = stale !== undefined && nowMs() - stale < USAGE_POLL_FLOOR_MS
  let layer = facts?.keyLayer
  if (readFromSeam !== undefined) {
    await readFromSeam()
    layer = facts?.keyLayer
  } else if (!insideFloor && seam !== undefined && typeof seam.describe === 'function') {
    const info = await seam.describe(AMD_KEY_REF_NAME).catch(() => undefined)
    if (info !== undefined && info !== null && typeof info.source === 'string') layer = info.source
  }
  const attempt = await readAmdUsage({
    providerId,
    seam,
    reference: AMD_KEY_REF_NAME,
    nowMs: nowMs(),
    ...(lastAttemptMs() === undefined ? {} : { lastAttemptMs: lastAttemptMs() as number }),
    ...(facts?.usage?.[providerId] === undefined ? {} : { previous: facts.usage[providerId] as UsageResult }),
    // The layer comes from the seam's own answer, resolved beside the key: it is a fact about
    // where the reading was taken from, and the page may only name it on a reading that is new.
    ...(layer === undefined ? {} : { layer }),
  })
  if (!attempt.tooSoon) stamp(attempt.atMs)
  if (facts !== undefined && attempt.usage !== null) {
    // A reading replaces this provider's entry; a failure keeps whatever was there (withProviderUsage
    // deletes on null, so a first-ever failure leaves the map without the key rather than with a zero).
    facts.usage = withProviderUsage(facts.usage, providerId, attempt.usage)
  }
  return attempt
}

/** The channel's lifetime is the plugin's lifetime. */
export function apply(
  ctx: {
    effect(callback: () => () => void): () => void
    inject?: (names: string[], callback: (child: InjectedServices) => void) => () => void
    llm?: {
      stream: (options: { provider: string; model: string; messages: unknown[]; signal?: AbortSignal }) => AsyncIterable<unknown>
    }
  },
  options: HostOptions = {},
): () => void {
  const nowMs = options.nowMs ?? (() => createSystemClock().now())
  return ctx.effect(() => {
    // The one object the seam writes into. It starts as NOTHING_READ -- every member absent, none
    // zero -- and only a read that came back may change it, because `reading()` is derived from
    // `accounts` being undefined here and nowhere else.
    const facts: MutableFacts = { ...(options.facts ?? NOTHING_READ) }

    // The intercept layer owns the gate, the metrics store, and the LLM stream hook.
    // It reads/writes the same `facts` object apply() uses, so the channel source and the
    // request recorder see one consistent view.
    //
    // Guard: DSH's ctx proxies `llm` behind `inject`. Accessing ctx.llm without
    // the llm service throws "cannot get property \"llm\" without inject" inside
    // the Proxy get trap, so `&&` short-circuit cannot save us. Use try/catch:
    // a context without llm simply falls back to seam-only hooks that still
    // answer real data through the key store.
    let interceptDisposer: (() => void) | undefined
    let interceptHooks: SourceHooks | undefined
    if (ctx.inject !== undefined) {
      try {
        const llm = ctx.llm
        if (llm !== undefined) {
          // createIntercept is synchronous: no top-level awaits, everything async is lazy.
          const intercept = createIntercept(
            {
              effect: ctx.effect,
              inject: ctx.inject,
              llm,
            },
            { facts, nowMs, rejectOnBudgetExhausted: options.rejectOnBudgetExhausted },
          )
          interceptDisposer = intercept.disposer
          interceptHooks = intercept.hooks
        }
      } catch {
        // llm service not available in this context; seam-only hooks below still work.
      }
    }

    // Both hooks read the current `seam` and `lastAttemptMs` when they are called, so they see a
    // service injected after this line. Whether they are *offered* is decided per request in
    // channel.ts: an install with no provider has no `readFromSeam` key at all, which is that
    // module's refusal, rather than a wrapper that is present and throws.
    let seam: CredentialSeam | undefined
    let lastAttemptMs: number | undefined

    // Fallback hooks when there is no LLM context to intercept: they still answer real data
    // through the seam, they just don't record new requests from the stream.
    const hooks: SourceHooks = interceptHooks ?? {
      readFromSeam: () => readSeamNow(seam, facts, onKeyStatus),
      testUsage: (providerId: ProviderId) =>
        askUsage(
          providerId,
          seam,
          nowMs,
          () => lastAttemptMs,
          stamp => {
            lastAttemptMs = stamp
          },
          facts,
          () => readSeamNow(seam, facts, onKeyStatus),
        ),
      readUsage: (providerId: ProviderId) =>
        askUsage(
          providerId,
          seam,
          nowMs,
          () => lastAttemptMs,
          stamp => {
            lastAttemptMs = stamp
          },
          facts,
          () => readSeamNow(seam, facts, onKeyStatus),
        ),
      readDashboard: () => {
        const events = facts.events ?? []
        return {
          trend: trendOf(events, nowMs(), READING_MINUTES),
          rows: rowsOf(events, READING_ROWS),
        }
      },
    }

    const source: ChannelSource = channelSourceFrom(facts, nowMs, hooks)
    const budget: IconBudget = RAIL_BUDGET
    const channel = openChannel({ source, budget })
    const drops: Array<() => void> = []

    const server = options.server
    if (server === undefined) {
      drops.push(injectOf(ctx, [WEB_SERVER_SERVICE], child => {
        const webServer = child.webServer
        if (webServer === undefined) return
        drops.push(serveOn(webServer, channel, channel.source))
      }))
    } else {
      drops.push(serveOn(server, channel, channel.source))
    }

    // Asked for unconditionally, which is the point of T-2-b's last leg. This injection used to be
    // armed only when a reader or a writer had been handed in, and an install the user merely enabled
    // hands in neither -- so the seam was never resolved, the facts never said who was there, and the
    // icon painted 0/0: a confident number about a pool nobody had looked .A reason to
    // paint is a reason to read, and the icon always has one.
    const onKeyStatus = options.onKeyStatus
    // The seam is assigned here and read by `hooks` at request time, so the route above and this
    // service need no ordering between them.
    drops.push(injectOf(ctx, [CREDENTIALS_SERVICE], child => {
      // The seam arrives here, possibly long after the route was claimed: `hooks` reads this
      // variable when it is called, so it sees whatever this line last assigned.
      seam = child.credentials
      // No seam at all stays indistinguishable from one that has not answered yet, and both read as
      // 'unread' downstream. That is deliberate: "I could not tell" is not "there are none".
      if (seam === undefined) return
      drops.push(reportKeyInto(child, facts, onKeyStatus))
      // The write half is handed to the page, not used here. apply() still writes nothing itself.
      if (options.acceptsWrites !== false) channel.offer(writesFor(seam))
    }))

    if (interceptDisposer !== undefined) drops.push(interceptDisposer)

    return () => {
      for (const drop of drops.reverse()) drop()
      channel.close()
    }
  })
}

export { NOTHING_READ, channelSourceFrom, type SourceFacts } from './source.js'

export {
  AMD_KEY_REF,
  CREDENTIALS_SERVICE,
  KEY_UPDATED_EVENT,
  clearKeyStatus,
  readKeyStatus,
  watchKeyStatus,
  writeKeyStatus,
  type KeyContext,
  type KeyStatus,
  type KeyWriteOutcome,
} from './credentials.js'
export { AMD_KEY_REFS, KNOWN_LAYERS, describeFailure, describeKey, forgetAmdKey, keyStateOf, saveAmdKey, type AmdKeyRef, type CredentialSeam, type KeyState, type KeyWrite } from './key-store.js'

export {
  CHANNEL,
  ENDPOINT_COMMAND,
  ENDPOINT_DASHBOARD,
  ENDPOINT_READING,
  ENDPOINT_SNAPSHOT,
  ENDPOINT_TEST,
  answerOf,
  buildPublishedView,
  openChannel,
  routeOf,
  serveOn,
  type BridgeAnswer,
  type BridgeRequest,
  type BridgeResponse,
  type Channel,
  type ChannelHandle,
  type ChannelSource,
  type IconBudget,
  type OpenChannelOptions,
  type PublishedView,
  type Route,
  type RouteServer,
} from './channel.js'

// New exports for the intercept layer (T-3-c)
export { createIntercept, type InterceptOptions, type InterceptHandle } from './intercept-index.js'