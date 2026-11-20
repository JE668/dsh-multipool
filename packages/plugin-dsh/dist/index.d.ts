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
export declare const VERSION = "0.0.2-rc.3";
/** DSH services this bundle reads. */
export declare const inject: readonly ['slots'];
/** The channel's lifetime is the plugin's lifetime. */
export declare function apply(ctx: {
    effect(callback: () => () => void): () => void;
}): () => void;
export { CHANNEL_KEY, buildPublishedView, openChannel, type Channel, type ChannelHandle, type ChannelSource, type ChannelTarget, type IconBudget, type OpenChannelOptions, type PublishedView, } from './channel.js';
//# sourceMappingURL=index.d.ts.map