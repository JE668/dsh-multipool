// Re-exported for the hand-written browser drawer (client.js), which loads this
// package from the page's module table and therefore needs values, not just types.
export {
  ICON_PROVIDER_ORDER,
  NO_VALUE,
  PROVIDER_SHORT_LABELS,
  accountsLine,
  badgeTextOf,
  iconLevelOf,
  iconViewOf,
  pointsLine,
  rpmLine,
  type IconCounts,
  type IconLevel,
  type IconLines,
  type IconView,
  type IconViewInput,
  type ProviderCountLine,
} from './icon-state.js'
export { emptySnapshot, PROVIDER_ORDER } from '@dsh-multipool/core'
export type { Snapshot, ProviderSnapshot, ProviderId } from '@dsh-multipool/core'
