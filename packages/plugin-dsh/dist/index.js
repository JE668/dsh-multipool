/**
 * Host half of dsh-multipool.
 *
 * The plugin registers one channel (packages/plugin-dsh/src/channel.ts) on the page's window and
 * nothing else yet: scheduling and the local proxy arrive in their own tasks, and until they do
 * the icon is expected to read the same empty snapshot a fresh install does.
 *
 * Entry points for the DSH loader:
 *
 * - `inject` names the services `apply` reads. Only `slots` for now -- the channel publishes the
 *   icon's view and does not touch the provider registry, so declaring more would only make the
 *   bundle refuse to load in a profile that lacks them.
 * - `apply(ctx)` opens the channel inside `ctx.effect`, so disabling the plugin disposes it and
 *   leaves no `window` key behind, and publishing stays pull-based: `apply` opens, it does not
 *   publish. Nothing here schedules a timer of its own (docs/05 section 4.3).
 */
import { openChannel } from './channel.js';
export const VERSION = '0.0.2-rc.3';
/** DSH services this bundle reads. */
export const inject = ['slots'];
/** The channel's lifetime is the plugin's lifetime. */
export function apply(ctx) {
    return ctx.effect(() => {
        const channel = openChannel({
            source: {
                accounts: () => [],
                events: () => [],
                usage: () => ({}),
                activeSessions: () => 0,
                queued: () => 0,
                nowMs: () => 0,
            },
            budget: { admitRpm: 0, sources: [] },
        });
        return () => channel.close();
    });
}
export { CHANNEL_KEY, buildPublishedView, openChannel, } from './channel.js';
//# sourceMappingURL=index.js.map