/**
 * Where a provider key lives, and who is allowed to read it back (T-2-e).
 *
 * The settings page does not store keys. DSH has a credential seam -- `ctx.credentials`, a
 * `CredentialProvider` service whose local implementation keeps `$DSH_HOME/.credentials.yaml` --
 * and that seam already owns everything a key needs: an environment-variable-shaped reference
 * name, an atomic write behind a file lock, a watcher that republishes external edits, and
 * `describe` that reports whether a value is configured without returning the value. Re-building
 * any of that inside the plugin would lose it, not gain it, so this module only names what the
 * plugin wants from the seam and keeps the shape testable without a live profile.
 *
 * What the plugin's own Config keeps is the reference -- `refs: ['AMD_API_KEY']` -- never the
 * secret. A patch file listing the names of keys is a harmless file; a patch file listing keys is
 * the leak, and the difference belongs in the schema, not in a reviewer's habit.
 *
 * Three rules, each with the seam member it answers to:
 *
 *   C-02 first. validateAmdKey refuses an `sk-` string or the instance-service host before any write
 *        happens, because docs/02 section 1.2 says a rejected key must not enter the catalogue --
 *        so it must not enter the credential store either.
 *   No cache. Every read goes through the seam again. The local provider documents the same rule
 *        for itself: resolve on each operation, never once at init.
 *   No empty string. The local provider refuses '' and points the caller at unset(), so this file
 *        does not hand it a value it will refuse. A blank field means "leave what is stored alone".
 */
import { type Validation } from '@dsh-multipool/core';
/** The reference names this plugin asks the credential seam for. 02 section 1.2 names the first. */
export declare const AMD_KEY_REFS: readonly ['AMD_API_KEY'];
export type AmdKeyRef = (typeof AMD_KEY_REFS)[number];
/**
 * DSH's credential seam, narrowed to what the plugin reads.
 *
 * `describe` answers whether a value is configured and which of the seam's four layers
 * (`file`, `env`, `project-env`, `user-env`) supplied it, never the value. `resolve` answers the value
 * when a request actually needs it.
 *
 * Declared here instead of imported from @deepseek-ai/dsh-credentials so the plugin builds against
 * one repo, not against one DSH install's type package; a context that carries the service satisfies
 * this shape, and a test can satisfy it with an object instead of a profile on disk.
 *
 * The shape follows 0.2.2-rc.5's own implementation, not the abstract class: dsh-credentials
 * declares these four and implements only the notify pair, so the argument list a caller can rely
 * on is the one dsh-credentials-local/it writes. Two details came from reading it rather than from
 * guessing. `masked` is optional because describe() only builds it for the file layer -- a key that
 * arrived from the environment or a .env file is reported configured with no preview at all, and a
 * required field would have made this plugin invent one (U-06). And a stored `''` cannot exist:
 * parseRefs rejects an empty value at boot and set() rejects one at write, so "configured" here
 * never means "configured to nothing" and no caller has to defend against it.
 */
export interface CredentialSeam {
    resolve(ref: string): Promise<{
        readonly value: string;
        readonly source?: string;
    } | undefined>;
    describe(ref: string): Promise<{
        readonly configured: boolean;
        readonly source?: string;
        readonly writable: boolean;
        /** Same-length code-point preview, file layer only. Never for env / project-env / user-env. */
        readonly masked?: string;
    }>;
    set(ref: string, value: string): Promise<void>;
    unset(ref: string): Promise<void>;
    /**
     * Ask the upstream, with the stored value attached, and hand back only its status and body (T-2-f).
     *
     * Optional because a seam may describe without speaking. When absent, the settings page says so
     * rather than reporting a failed request it never made. The value never returns through here: this
     * member exists so the one place that holds a key is also the one place that spends it.
     */
    fetch?(url: string, init: {
        readonly method: string;
    }): Promise<{
        readonly status: number;
        text(): Promise<string>;
    }>;
}
/** What a key field may say about itself without claiming anything it has not read (U-06). */
export type KeyState = 
/** The seam answered: a value is there, in one of its layers. */
{
    readonly kind: 'configured';
    readonly layer: KeyLayer;
}
/** The seam answered: nothing is there. Not an error -- nothing has been filled in yet. */
 | {
    readonly kind: 'absent';
}
/** Nobody answered: this context carries no credential service. */
 | {
    readonly kind: 'unavailable';
}
/** The seam threw. The reason is scrubbed; the key itself was never in it. */
 | {
    readonly kind: 'refused';
    readonly reason: string;
};
export type KeyLayer = 'file' | 'env' | 'project-env' | 'user-env';
/**
 * `unavailable` and `refused` stay apart because one is a fact about the install and the other
 * is a fault: a form that painted both the same would hide the bug behind a blank field.
 */
export declare function keyStateOf(info: unknown): KeyState;
export declare function describeKey(seam: CredentialSeam | undefined, ref: string): Promise<KeyState>;
/** Scrubbed, because a thrown value is text, and text is where a secret ends up. */
export declare function describeFailure(error: unknown): string;
export interface KeyWrite {
    readonly ref: string;
    readonly value: string;
}
/**
 * Validate first, write second (C-02). Returns either the rejection the form shows or ok:true
 * once the seam accepted the value -- so "saved" is only ever said after the store said yes.
 */
export declare function saveAmdKey(seam: CredentialSeam | undefined, input: KeyWrite): Promise<Validation<string>>;
/** Clear a stored key. Same path as save, so a form has one "did it work" branch. */
export declare function forgetAmdKey(seam: CredentialSeam | undefined, ref: string): Promise<void>;
//# sourceMappingURL=key-store.d.ts.map