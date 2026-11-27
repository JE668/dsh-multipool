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
import { scrubSecrets, validateAmdKey } from './vendor/core/index.js';
/** The reference names this plugin asks the credential seam for. 02 section 1.2 names the first. */
export const AMD_KEY_REFS = ['AMD_API_KEY'];
/**
 * The four layer names DSH 0.2.2-rc.5 ships, as this repo spells them in its own words.
 *
 * A union, not the type of the field: the seam may name a fifth one day, and a form that refused to
 * carry it would be this repo deciding the seam cannot answer -- the same invention the old
 * `includes()` guard made, only at the type level. The field is `string`; this name is the list the
 * page has words for (client.js layerWord, docs/05 section 2.3).
 */
export const KNOWN_LAYERS = ['file', 'env', 'project-env', 'user-env'];
/**
 * `unavailable` and `refused` stay apart because one is a fact about the install and the other
 * is a fault: a form that painted both the same would hide the bug behind a blank field.
 */
export function keyStateOf(info) {
    if (info === null || typeof info !== 'object')
        return { kind: 'absent' };
    const record = info;
    if (record.configured !== true)
        return { kind: 'absent' };
    const layer = record.source;
    // A layer name the seam supplies is a fact, and it travels as given. Whether this repo has a word
    // for it is a question the page asks about its own vocabulary, not one this module may answer by
    // filing an unknown name under 'file' -- which would be inventing a location the seam never named.
    if (typeof layer === 'string' && layer !== '')
        return { kind: 'configured', layer };
    // configured with an unnamed layer: the value is there, and saying where would be a guess.
    return { kind: 'configured', layer: 'file' };
}
export function describeKey(seam, ref) {
    if (seam === undefined)
        return Promise.resolve({ kind: 'unavailable' });
    return seam.describe(ref).then(info => keyStateOf(info), (error) => ({ kind: 'refused', reason: describeFailure(error) }));
}
/** Scrubbed, because a thrown value is text, and text is where a secret ends up. */
export function describeFailure(error) {
    const message = error instanceof Error ? error.message : String(error);
    return scrubSecrets(message);
}
/**
 * Validate first, write second (C-02). Returns either the rejection the form shows or ok:true
 * once the seam accepted the value -- so "saved" is only ever said after the store said yes.
 */
export async function saveAmdKey(seam, input) {
    const checked = validateAmdKey(input.value);
    if (!checked.ok)
        return checked;
    if (seam === undefined) {
        return {
            ok: false,
            rejection: {
                field: input.ref,
                rule: 'C-02',
                reason: 'no credential service',
                message: 'no credential service is on this context, so the key was not saved',
            },
        };
    }
    await seam.set(input.ref, checked.value);
    return checked;
}
/** Clear a stored key. Same path as save, so a form has one "did it work" branch. */
export async function forgetAmdKey(seam, ref) {
    if (seam === undefined)
        return;
    await seam.unset(ref);
}
//# sourceMappingURL=key-store.js.map