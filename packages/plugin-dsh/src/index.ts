/**
 * Host half of dsh-multipool.
 *
 * The plugin registers one channel (packages/plugin-dsh/src/channel.ts) on the page's window and
 * nothing else yet: scheduling and the local proxy arrive in their own tasks, and until they do
 * the icon is expected to read the same empty snapshot a fresh install does.
 */

export const VERSION = '0.0.2-rc.3'

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
