/**
 * The host half's key answer, asked through the credential seam DSH actually ships (T-2-e).
 *
 * docs/02 section 1.2 already fixed the reference name, and key-store.ts already fixed how a key is
 * validated and how a failure is scrubbed. This file adds the two things that were still missing: the
 * place a live plugin context meets a seam that may be absent at all, and the arming of a re-read.
 *
 * Four rules, each borrowed from a document that argued for it:
 *
 * 1. Reading is the only thing that happens on its own. Nothing here writes. A plugin that was enabled
 *    must not be a plugin that touched the credentials document -- the same rule docs/05 section 4.3
 *    puts on a dashboard that polls by itself.
 * 2. Removing goes through `unset` (key-store.ts `forgetAmdKey`), never through `set('')`. The local
 *    provider throws on an empty value and points at `unset`; adopting that split here means the seam's
 *    own diagnostics stay true instead of being worked around.
 * 3. `masked` is not required to be present (key-store.ts `CredentialSeam`). 0.2.2-rc.5 builds the
 *    preview for the file layer alone, so a key inherited from the environment or a .env file answers
 *    configured with no preview at all. A form that demanded one would have to invent it -- U-06
 *    forbids exactly that.
 * 4. A re-read is registered only when a caller hands it the channel it would publish into. An
 *    enabled-but-unpublishing plugin yields no listener, so enabling it still writes nothing to the
 *    page's event table; once `apply` has published, there is a reader, and the seam's own
 *    `credentials/reference-updated` event is the cheapest honest way to know the document moved.
 */

import { AMD_KEY_REFS, describeFailure, describeKey, forgetAmdKey, saveAmdKey } from './key-store.js'
import type { CredentialSeam, KeyState } from './key-store.js'

/** The service name dsh-credentials registers. `credentials-local` is one implementation of it. */
export const CREDENTIALS_SERVICE = 'credentials'

/** The reference this plugin reads when it builds a request. 02 section 1.2 defines it. */
export const AMD_KEY_REF: string = AMD_KEY_REFS[0]

/**
 * The event the seam fans out after a write or a reload committed, with the reference as its
 * argument (dsh-credentials `notifyUpdated`). An external edit of the document reaches a subscriber
 * through this and nothing else, so it is also the only way to learn one happened.
 */
export const KEY_UPDATED_EVENT = 'credentials/reference-updated'

/** What the seam answered, and -- when it answered -- what can still be asked of it. */
export type KeyStatus =
  | { readonly kind: 'read'; readonly state: KeyState; readonly seam: CredentialSeam }
  | { readonly kind: 'no-service' }

/**
 * The part of a cordis context this module uses. Declared here rather than imported so a test can
 * satisfy it with two functions and so the plugin keeps building against one repo, not one DSH
 * install's event typings.
 */
export interface KeyContext {
  readonly credentials?: CredentialSeam | undefined
  on?(name: string, listener: (...args: readonly unknown[]) => void): unknown
}

/**
 * Ask once, and say which of the two silences happened: nothing stored, or nothing to ask.
 * Both read as "not configured" to a user, and only one of them is theirs to fix.
 */
export async function readKeyStatus(
  context: { readonly credentials?: CredentialSeam | undefined },
  ref: string = AMD_KEY_REF,
): Promise<KeyStatus> {
  const seam = context.credentials
  if (seam === undefined) return { kind: 'no-service' }
  return { kind: 'read', state: await describeKey(seam, ref), seam }
}

/**
 * Re-ask whenever the seam says the reference moved, and not otherwise.
 *
 * `onRead` is told only about this plugin's own reference: another plugin's key changing is its
 * event, not this one's news. The listener is detached through the same disposer this returns, so
 * dropping the plugin drops the subscription -- cordis also removes a listener when its fiber goes
 * away, but a caller replacing the reader mid-flight would not, and that caller is what the shape is
 * for.
 *
 * With no context `on` (a bare object in a test, an install whose context predates the event mixin), this
 * still reads once and returns; it just has nothing to listen to afterwards.
 */
export function watchKeyStatus(
  context: KeyContext,
  onRead: (status: KeyStatus) => void,
  ref: string = AMD_KEY_REF,
): () => void {
  let disposed = false

  const read = (): void => {
    if (disposed) return
    void readKeyStatus(context, ref).then(status => {
      if (disposed) return
      onRead(status)
    })
  }

  read()

  if (typeof context.on !== 'function') return () => {
    disposed = true
  }

  const forget = context.on(KEY_UPDATED_EVENT, (moved: unknown) => {
    if (moved === ref) read()
  })

  return () => {
    disposed = true
    if (typeof forget === 'function') forget()
  }
}

/**
 * What a write attempt ends as: the state to render, and one sentence for the row that made it.
 *
 * `state` is the re-read KeyState and not what `saveAmdKey` returned, because those answer
 * different questions -- saveAmdKey says the store took the value, this says the seam will hand it
 * back. Only the second belongs on a page that reintroduces itself from `describe` on next load. A
 * successful save whose re-read still answers absent is therefore reported as absent, with a note.
 */
export interface KeyWriteOutcome {
  readonly status: KeyStatus
  /** Null when nothing was written: a refusal, or no service to write to. */
  readonly message: string | null
}

/**
 * The write path, called by a form and by nothing else.
 *
 * Two deliberate choices. A refusal never reaches the seam -- key-store.ts throws before writing and
 * says why in docs/02's words -- so `key` here is still the scrubber's job and not a new validation
 * layer's. And a confirm read that throws is not turned into a failure of the write: the store may
 * have committed, and claiming otherwise would be the one guess this module exists to avoid. The
 * `nothing was written` sentence is about the attempt only, so a save that failed to confirm sends
 * the user to a form that re-reads, not to a retry that might overwrite a good key.
 */
export async function writeKeyStatus(
  context: { readonly credentials?: CredentialSeam | undefined },
  key: string,
  ref: string = AMD_KEY_REF,
): Promise<KeyWriteOutcome> {
  const seam = context.credentials
  try {
    const saved = await saveAmdKey(seam, { ref, value: key })
    // The refusal is key-store's own wording (docs/02 section 1.2), so a seam was there to be handed
    // it; the state is still the read, which is what a form paints after a refusal, not a guess of
    // absent made here.
    if (!saved.ok) return { status: await readKeyStatus(context, ref), message: saved.rejection.message }
  } catch (error) {
    // The store owns its own rules (an empty value, a disposed provider) and states them in its
    // own words. Those words are about the field, but they are still text on its way to a log.
    return { status: await readKeyStatus(context, ref), message: describeFailure(error) }
  }
  return { status: await readKeyStatus(context, ref), message: null }
}

/**
 * Forget the key and report what a read says afterwards.
 *
 * `unset` is idempotent in the provider (an absent key is not written and not announced), so this
 * never has to ask whether anything was there -- and it never calls `set("")`, which the provider
 * refuses with a message that would read like a bug in this plugin.
 */
export async function clearKeyStatus(
  context: { readonly credentials?: CredentialSeam | undefined },
  ref: string = AMD_KEY_REF,
): Promise<KeyWriteOutcome> {
  const seam = context.credentials
  try {
    await forgetAmdKey(seam, ref)
  } catch (error) {
    return { status: await readKeyStatus(context, ref), message: describeFailure(error) }
  }
  return { status: await readKeyStatus(context, ref), message: null }
}

