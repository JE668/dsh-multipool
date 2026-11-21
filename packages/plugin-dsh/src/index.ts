/**
 * Host half of dsh-multipool.
 *
 * The plugin registers one channel (packages/plugin-dsh/src/channel.ts) on the page's window and
 * hands it the facts it has. Scheduling, the key store and the local proxy arrive in their own
 * tasks; until they do, those facts are "nothing has been read yet", which source.ts spells as
 * `undefined` rather than as zero.
 *
 * Entry points for the DSH loader:
 *
 * - No `inject` on purpose. `slots` lives in the browser half (dsh-cordis-client-runner), so
 *   naming it here parked this entry in "pending (waiting for service: slots)" forever -- the
 *   host fiber would never see it, and the icon never got a chance to ask for the sidebar slot.
 *   `apply` reads nothing but `ctx.effect`, which every context has.
 * - `credentials` is asked for with `ctx.inject`, never listed in `inject`, and takes no part in
 *   whether this plugin activates (T-2-e). A key is what makes it able to send, not what makes it
 *   load: a DSH built without dsh-credentials-local (or with it disabled) must still show the icon,
 *   and the icon's honest answer there is "no credential service", not a refused plugin. The
 *   child's status is reported through `onKeyStatus` and nothing else in this file waits on it.
 * - `apply(ctx)` opens the channel inside `ctx.effect`, so disabling the plugin disposes it and
 *   leaves no `window` key behind, and publishing stays pull-based: `apply` opens, it does not
 *   publish. Nothing here schedules a timer of its own (docs/05 section 4.3).
 * - The clock is the injected one a caller passes in. This file never reads Date.now, so the
 *   icon's timestamps can be replayed exactly in a test that controls time (07 Z-03).
 */

import { createSystemClock } from '@dsh-multipool/core'
import {
  AMD_KEY_REF_NAME,
  openChannel,
  type ChannelSource,
  type ChannelWrites,
  type CommandOutcome,
  COMMAND_NO_WRITES,
  type IconBudget,
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


/** The channel's lifetime is the plugin's lifetime. */
export function apply(
  ctx: {
    effect(callback: () => () => void): () => void
    inject?(names: string[], callback: (child: KeyContext) => void): () => void
  },
  options: HostOptions = {},
): () => void {
  const nowMs = options.nowMs ?? (() => createSystemClock().now())
  return ctx.effect(() => {
    const source: ChannelSource = channelSourceFrom(options.facts ?? NOTHING_READ, nowMs)
    const budget: IconBudget = { admitRpm: NO_ADMIT_RPM, sources: NO_BUDGET_SOURCES }
    const channel = openChannel({ source, budget })
    const drops: Array<() => void> = []
    // Off unless somebody reads the answer: an enabled plugin with no form open must not show up in
    // the page's listener table, which is what the comment above "no inject" promises in practice.
    const onKeyStatus = options.onKeyStatus
    const inject = ctx.inject
    // Neither a reader nor a writer means no listener: the injection below is the one thing that would
    // put this plugin in the page's event table with nothing to do there.
    if (typeof inject === 'function' && (onKeyStatus !== undefined || options.acceptsWrites === true)) {
      drops.push(inject.call(ctx, [CREDENTIALS_SERVICE], child => {
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
  CHANNEL_KEY,
  buildPublishedView,
  openChannel,
  type Channel,
  type ChannelHandle,
  type ChannelSource,
  type ChannelTarget,
  type IconBudget,
  type OpenChannelOptions,
  type PublishedView,
} from './channel.js'
