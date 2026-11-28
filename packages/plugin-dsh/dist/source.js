/**
 * What the host half is allowed to say about itself, and what it is not (docs/05 section 2.3).
 *
 * The channel publishes whatever `ChannelSource` answers. Those answers come from somewhere, and
 * today that somewhere has no scheduler and no key store: `apply()` opens the channel with empty
 * lists, so the icon shows the same thing a fresh install shows. That is not a placeholder to be
 * filled with zeroes -- it is the honest report that nothing has been read yet.
 *
 * Two rules keep it honest as sources arrive:
 *
 * 1. A source that has not read anything answers `undefined`, never `0` and never `[]`-with-a-zero
 *    in it. `accounts` returning `[]` and `accounts` returning nothing yet are different claims:
 *    the first says "I asked, the pool is empty", the second says "I have not asked". Only the
 *    first may turn the icon grey, and only a real key store can make it.
 * 2. `usage` absent for a provider means "no reading", not "zero used". snapshot.ts already leaves
 *    the numbers off in that case, and this file must not manufacture the empty map that would
 *    smuggle a zero back in under another name.
 */
/** A source that has nothing to report yet: every member is absent, none is zero. */
export const NOTHING_READ = {
    accounts: undefined,
    events: undefined,
    usage: undefined,
    activeSessions: undefined,
    queued: undefined,
    keyLayer: undefined,
};
/**
 * The channel's shape, filled from facts that may be absent.
 *
 * Absent facts collapse to the smallest honest answer rather than the friendliest one: no accounts
 * reads as an empty list, because the snapshot type has no slot for "unknown list" and a count of
 * items you have not looked for is not a count. No usage reading stays out of the map entirely.
 *
 * `reading` is the exception, and it is why the sentence above is only half true: `accounts ?? []`
 * gives snapshot.ts a list it can count, and a count is a number, so an unread pool arrives at the
 * badge as 0/0 -- the same glyph as a pool that was read and found empty. The third answer has to be
 * carried alongside the list, not deduced from it.
 */
export function channelSourceFrom(facts, nowMs, hooks) {
    return {
        accounts: () => facts.accounts ?? [],
        events: () => facts.events ?? [],
        // A provider with no reading is absent from the object, not present as null: null is how a
        // caller would spell "I know there is no usage endpoint here", which is a claim, not silence.
        usage: () => facts.usage ?? {},
        // The seam, when somebody still holds it: the page's test button reads through this rather than
        // through a copy of the key, because there is no copy of the key.
        // The write/read hooks the plugin's apply() owns: a re-read of the seam, and the one request
        // that leaves this process. Neither is derivable from `facts` (source.ts rule 1), so both are
        // spliced in when their owner supplies them and absent otherwise.
        ...(hooks?.readFromSeam === undefined ? {} : { readFromSeam: hooks.readFromSeam }),
        ...(hooks?.testUsage === undefined ? {} : { testUsage: hooks.testUsage }),
        ...(hooks?.readUsage === undefined ? {} : { readUsage: hooks.readUsage }),
        ...(hooks?.readDashboard === undefined ? {} : { readDashboard: hooks.readDashboard }),
        activeSessions: () => facts.activeSessions ?? 0,
        queued: () => facts.queued ?? 0,
        nowMs,
        // The one member channelSourceFrom cannot fill in from facts, and the one that decides whether
        // the other answers are worth painting: `accounts ?? []` above is a true statement about the list
        // this file was handed, and a false one about the pool, when nobody has been asked yet.
        // So it is not derived here -- it is the caller saying whether the read happened at all.
        reading: () => readingOf(facts),
        keyLayer: () => keyLayerOf(facts),
    };
}
/**
 * Which layer last answered, or nothing at all when nobody has asked yet.
 *
 * The name travels as the seam spelled it -- this module does not keep a list of layers it approves
 * of. A seam that answers some fifth word is answering a question this file never asked it, and
 * whether the page has a sentence for that word is the page's vocabulary to hold (client.js,
 * layerWord). Spelling the four out here would put the same decision in two places, and the copy
 * that runs first would win: the seam's new layer would reach the page as "no one has read",
 * which is a lie with a question mark in it.
 *
 * Absent only when nobody has asked, which is the absence the page is allowed to describe.
 */
export function keyLayerOf(facts) {
    // NOTHING_READ leaves the member out, so reading it off here is reading a value that may simply
    // not exist yet -- TypeScript happily calls it string | undefined because the interface does,
    // and the settings page then prints a layer nobody reported. The runtime check is the one that
    // matters: absent facts, absent layer. Anything else is what the seam said.
    const seen = facts.keyLayer;
    if (typeof seen !== 'string')
        return undefined;
    return seen;
}
/** Unread when the list is absent; empty or read when it was handed over, judged by its size. */
export function readingOf(facts) {
    if (facts.accounts === undefined)
        return 'unread';
    return facts.accounts.length === 0 ? 'empty' : 'read';
}
//# sourceMappingURL=source.js.map