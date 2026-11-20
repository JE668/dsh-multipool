/**
 * Host half of dsh-multipool.
 *
 * The plugin registers one channel (packages/plugin-dsh/src/channel.ts) on the page's window and
 * nothing else yet: scheduling and the local proxy arrive in their own tasks, and until they do
 * the icon is expected to read the same empty snapshot a fresh install does.
 *
 * Entry points for the DSH loader:
 *
 * - No `inject` on purpose. `slots` lives in the browser half (dsh-cordis-client-runner), so
 *   naming it here parked this entry in "pending (waiting for service: slots)" forever -- the
 *   host fiber would never see it, and the icon never got a chance to ask for the sidebar slot.
 *   `apply` reads nothing but `ctx.effect`, which every context has.
 * - `apply(ctx)` opens the channel inside `ctx.effect`, so disabling the plugin disposes it and
 *   leaves no `window` key behind, and publishing stays pull-based: `apply` opens, it does not
 *   publish. Nothing here schedules a timer of its own (docs/05 section 4.3).
 */
export declare const VERSION = "0.0.2-rc.3";
/** The channel's lifetime is the plugin's lifetime. */
export declare function apply(ctx: {
    effect(callback: () => () => void): () => void;
}): () => void;
export { CHANNEL_KEY, buildPublishedView, openChannel, type Channel, type ChannelHandle, type ChannelSource, type ChannelTarget, type IconBudget, type OpenChannelOptions, type PublishedView, } from './channel.js';
//# sourceMappingURL=index.d.ts.map