/**
 * The host half's key answer, asked through the credential seam DSH actually ships (T-2-e).
 *
 * docs/02 section 1.2 already fixed the reference name, and key-store.ts already fixed how a key is
 * validated and how a failure is scrubbed. This file adds one thing: the place a live plugin context
 * meets a seam that may be absent, so that "no credential service" is a state a form can render and not
 * a crash that takes the plugin down with it.
 *
 * Three rules it keeps, each borrowed from a document that argued for it:
 *
 * 1. Reading is the only thing that happens on its own. This module asks; nothing in it writes. A
 *    plugin that was enabled must not be a plugin that touched the credentials document -- the same
 *    rule docs/05 section 4.3 puts on a dashboard that polls by itself.
 * 2. Removing goes through `unset` (key-store.ts `forgetAmdKey`), never through `set('')`. The local
 *    provider throws on an empty value and points at `unset`; adopting that split here means the
 *    seam's own diagnostics stay true instead of being worked around.
 * 3. `masked` is not required to be present (key-store.ts `CredentialSeam`). 0.2.2-rc.5 builds the
 *    preview for the file layer alone, so a key inherited from the environment answers configured
 *    with no preview. A form that demanded one would have to invent it -- U-06 forbids exactly that.
 */

import { AMD_KEY_REFS, describeKey } from './key-store.js'
import type { CredentialSeam, KeyState } from './key-store.js'

/** The service name dsh-credentials registers. `credentials-local` is one implementation of it. */
export const CREDENTIALS_SERVICE = 'credentials'

/** The reference this plugin reads when it builds a request. 02 section 1.2 defines it. */
export const AMD_KEY_REF: string = AMD_KEY_REFS[0]

/** What the seam answered, and -- when it answered -- what can still be asked of it. */
export type KeyStatus =
  | { readonly kind: 'read'; readonly state: KeyState; readonly seam: CredentialSeam }
  | { readonly kind: 'no-service' }

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
