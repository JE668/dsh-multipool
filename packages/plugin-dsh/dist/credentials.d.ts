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
import type { CredentialSeam, KeyState } from './key-store.js';
/** The service name dsh-credentials registers. `credentials-local` is one implementation of it. */
export declare const CREDENTIALS_SERVICE = "credentials";
/** The reference this plugin reads when it builds a request. 02 section 1.2 defines it. */
export declare const AMD_KEY_REF: string;
/**
 * The event the seam fans out after a write or a reload committed, with the reference as its
 * argument (dsh-credentials `notifyUpdated`). An external edit of the document reaches a subscriber
 * through this and nothing else, so it is also the only way to learn one happened.
 */
export declare const KEY_UPDATED_EVENT = "credentials/reference-updated";
/** What the seam answered, and -- when it answered -- what can still be asked of it. */
export type KeyStatus = {
    readonly kind: 'read';
    readonly state: KeyState;
    readonly seam: CredentialSeam;
} | {
    readonly kind: 'no-service';
};
/**
 * The part of a cordis context this module uses. Declared here rather than imported so a test can
 * satisfy it with two functions and so the plugin keeps building against one repo, not one DSH
 * install's event typings.
 */
export interface KeyContext {
    readonly credentials?: CredentialSeam | undefined;
    on?(name: string, listener: (...args: readonly unknown[]) => void): unknown;
}
/**
 * Ask once, and say which of the two silences happened: nothing stored, or nothing to ask.
 * Both read as "not configured" to a user, and only one of them is theirs to fix.
 */
export declare function readKeyStatus(context: {
    readonly credentials?: CredentialSeam | undefined;
}, ref?: string): Promise<KeyStatus>;
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
export declare function watchKeyStatus(context: KeyContext, onRead: (status: KeyStatus) => void, ref?: string): () => void;
//# sourceMappingURL=credentials.d.ts.map