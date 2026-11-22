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

import { createSystemClock } from '@dsh-multipool/core'
import {
  AMD_KEY_REF_NAME,
  bridgeOf,
  openChannel,
  type ChannelSource,
  type ChannelWrites,
  type CommandOutcome,
  COMMAND_NO_WRITES,
  type IconBudget,
  type BridgeTarget,
} from './channel.js'
import {
  CREDENTIALS_SERVICE,
  clearKeyStatus,
  watchKeyStatus,
  writeKeyStatus,
  type KeyContext,
  type KeyStatus,
  type KeyWriteOutcome,
} from './credentials.js'
import type { CredentialSeam } from './key-store.js'
import { NOTHING_READ, channelSourceFrom } from './source.js'

export const VERSION = '0.0.2-rc.4'

/** The icon prints this until a task computes the real account budget (04 section 2.2). */
export const NO_BUDGET_SOURCES: readonly string[] = []
export const NO_ADMIT_RPM = 0

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
   * Offer the write half to the page's command() (T-2-e). Off unless asked for.
   *
   * A host that takes no writes never resolves `credentials` at all, so an install without a
   * credential provider stays absent from it instead of being described as missing one.
   */
  readonly acceptsWrites?: boolean
  /**
   * Where the bridge listens. Defaults to `globalThis`, which is the renderer's window in DSH.
   *
   * A test has no window and should not be handed one: it passes a plain object here and dispatches
   * on it. Same seam as the old ChannelTarget, one process simpler.
   */
  readonly target?: BridgeTarget
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
 * What an injection hands back: whichever of the named services the context has.
 *
 * Only `credentials` is here now. The bridge stopped being a service when it moved to window events
 * -- a window is not something a context provides, so there was nothing left to inject for it.
 */
interface InjectedServices {
  readonly credentials?: CredentialSeam
}

/**
 * ctx.inject, or a no-op when the context predates the mixin.
 *
 * apply()'s one remaining injection goes through here, so "this DSH has no inject" stays one branch
 * instead of two, and a context that cannot inject is still a context the icon activates on.
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

/** The channel's lifetime is the plugin's lifetime. */
export function apply(
  ctx: {
    effect(callback: () => () => void): () => void
    inject?: (names: string[], callback: (child: InjectedServices) => void) => () => void
  },
  options: HostOptions = {},
): () => void {
  const nowMs = options.nowMs ?? (() => createSystemClock().now())
  return ctx.effect(() => {
    const source: ChannelSource = channelSourceFrom(options.facts ?? NOTHING_READ, nowMs)
    const budget: IconBudget = { admitRpm: NO_ADMIT_RPM, sources: NO_BUDGET_SOURCES }
    const channel = openChannel({ source, budget })
    const drops: Array<() => void> = []
    // The bridge comes first because it is the only thing that makes the icon reachable at all: an
    // opened channel nobody can ask is a handle dropped on the floor.
    //
    // No injection, and nothing to wait for: window events live on the window this process already
    // has. The previous route did wait, on a `connection` service that DSH provides only to its own
    // client bundle, so the callback never came and the icon dashed while the host was healthy.
    drops.push(bridgeOf(channel, options.target))
    // Off unless somebody reads the answer: an enabled plugin with no form open must not show up in
    // the page's listener table, which is what the comment above "no inject" promises in practice.
    const onKeyStatus = options.onKeyStatus
    // Neither a reader nor a writer means no listener: the injection below is the one thing that would
    // put this plugin in the page's event table with nothing to do there.
    if (onKeyStatus !== undefined || options.acceptsWrites === true) {
      drops.push(injectOf(ctx, [CREDENTIALS_SERVICE], child => {
        const seam = child.credentials
        if (seam === undefined) return
        if (onKeyStatus !== undefined) drops.push(watchKeyStatus(child, onKeyStatus))
        // The write half is handed to the page, not used here. apply() still writes nothing itself.
        if (options.acceptsWrites === true) channel.offer(writesFor(seam))
      }))
    }
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
export { AMD_KEY_REFS, describeFailure, describeKey, forgetAmdKey, keyStateOf, saveAmdKey, type AmdKeyRef, type CredentialSeam, type KeyLayer, type KeyState, type KeyWrite } from './key-store.js'

export {
  BRIDGE_EVENT,
  BRIDGE_REPLY,
  ENDPOINT_COMMAND,
  ENDPOINT_SNAPSHOT,
  answerOf,
  bridgeOf,
  buildPublishedView,
  openChannel,
  readBridgeRequest,
  type BridgeAnswer,
  type BridgeReply,
  type BridgeRequest,
  type BridgeTarget,
  type Channel,
  type ChannelHandle,
  type ChannelSource,
  type IconBudget,
  type OpenChannelOptions,
  type PublishedView,
} from './channel.js'
