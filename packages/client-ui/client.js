/**
 * The browser half of dsh-multipool, as DSH loads it (dsh-doc references/ui-plugin.md).
 *
 * The module loader gets one lazy factory whose id equals the package name. React comes from the
 * page's module table, so this file requires it rather than bundling a second copy.
 *
 * The host half runs in a different process and cannot reach that table, so it hands its view over
 * on window instead:
 *
 *   window[CHANNEL] = {
 *     view(): IconView,                 // built by core.iconViewOf
 *     subscribe(fn): () => void,        // called on every change, returns an unsubscribe
 *   }
 *
 * Until such a channel exists the icon paints the empty pool: grey, 0/0, three dashes. That is the
 * right answer for a fresh install, and for a host that is not running it is the only answer we
 * have that is not a guess.
 */
window.__ModuleLoader__.load({
  id: 'dsh-multipool',
  factory(require) {
    const React = require('react')
    const core = require('./dist/index.js')
    const CHANNEL = '@dsh-multipool/plugin-client/view'
    function emptyView() {
      return core.iconViewOf({
        snapshot: core.emptySnapshot(),
        budget: { admitRpm: 0, sources: [] },
        pointsProviderId: null,
        attached: false,
      })
    }
    // The four states ride on host tokens that exist (dsh-doc references/ui-plugin.md), so a
    // light/dark switch repaints them without this file knowing a single colour value.
    var LEVEL_TOKEN = {
      green: '--dsw-alias-state-success-primary',
      yellow: '--dsw-alias-state-warn-primary',
      red: '--dsw-alias-state-error-primary',
      grey: '--dsw-alias-state-idle-primary',
    }

    function levelColor(level) {
      return 'var(' + LEVEL_TOKEN[level] + ')'
    }
    function Ring(props) {
      return React.createElement(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: props.size,
          height: props.size,
          'aria-hidden': true,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.75,
        },
        React.createElement('circle', { cx: 12, cy: 12, r: 9 }),
        React.createElement('circle', { cx: 12, cy: 12, r: 4.5 }),
      )
    }

    /**
     * The sidebar row, rendered by the sidebar rather than by us: it supplies the button, the
     * selection state and the tooltip chrome-, and passes { size, active } down.
     *
     * Three lines of text travel in title/aria-label, because the tooltip is the whole UI once
     * the rail is collapsed to 56px and the popover is unreachable (docs/05 section 2.3). They are
     * one string on purpose: a browser tooltip that needs to be hovered line by line is not a
     * fallback you can read at a glance.
     */
    function SidebarIcon(props) {
      const pair = React.useState(emptyView)
      const view = pair[0]
      const setView = pair[1]

      React.useEffect(function () {
        const channel = window[CHANNEL]
        if (channel === undefined || channel === null) return undefined
        setView(channel.view())
        return channel.subscribe(setView)
      }, [])

      const title = view.lines.accounts + '\n' + view.lines.rpm + '\n' + view.lines.points

      // The rail has room for the glyph and nothing else; a 24px slot leaves a 6px corner for a dot.
      const small = props.size <= 20
      const badge = React.createElement(
        'span',
        {
          'data-multipool-badge': view.level,
          'aria-hidden': true,
          style: small
            ? {
                position: 'absolute',
                right: -1,
                bottom: -1,
                width: 6,
                height: 6,
                borderRadius: 3,
                background: levelColor(view.level),
              }
            : {
                position: 'absolute',
                right: -4,
                bottom: -4,
                padding: '0 2px',
                borderRadius: 4,
                background: levelColor(view.level),
                color: 'var(--dsw-alias-bg-base)',
                fontSize: 9,
                fontWeight: 600,
                lineHeight: '12px',
                letterSpacing: 0,
              },
        },
        small ? null : view.badge,
      )

      return React.createElement(
        'span',
        {
          'data-multipool-level': view.level,
          'data-multipool-active': props.active ? 'true' : 'false',
          role: 'img',
          title: title,
          'aria-label': title,
          style: {
            position: 'relative',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: props.size,
            height: props.size,
            // The host paints the selected row itself; only the state moves with the data.
            color: levelColor(view.level),
          },
        },
        React.createElement(Ring, { size: props.size }),
        badge,
      )
    }

    return {
      // docs/05 section 2: inject so the slot owner can call us again after a remount, and
      // register inside ctx.effect so disabling the plugin unregisters instead of leaving a
      // ghost behind for the next enable to paint over (06 T-2-b DoD).
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.effect(() =>
            ctx.slots.register(
              {
                name: 'sidebar.panellist',
                id: 'dsh-multipool',
                order: 30,
              },
              SidebarIcon,
            ),
          ),
        )
      },
    }
  },
})
