/**
 * The browser half of dsh-multipool, as DSH loads it (dsh-doc references/ui-plugin.md).
 *
 * The module loader gets one lazy factory whose id equals the package name. React is the one
 * thing this file requires: it comes from the page's module table and bundling a second copy
 * would break hooks exactly as it would anywhere else.
 *
 * Nothing else may be required. client-modules treats a bundle as one opaque file -- a relative
 * require primes no id, and a bare one is served by nobody -- so importing ./dist/index.js from
 * here fails with "missed the module table" on every enable. The arithmetic below is therefore
 * spelled out instead of imported, and icon-state.test.ts holds the two copies to one answer over
 * a shared table of snapshots.
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
    const CHANNEL = '@dsh-multipool/plugin-client/view'
    var NO_VALUE = '\u2014'
    var ICON_PROVIDER_ORDER = ['amd', 'nim', 'sensenova', 'agnes', 'google']
    var PROVIDER_SHORT_LABELS = { amd: 'AMD', nim: 'NIM', sensenova: 'SenseNova', agnes: 'Agnes', google: 'Google' }

    function iconLevelOf(overall, configured, attached) {
      var heard = attached === undefined ? true : attached
      if (!configured || overall.total === 0) return heard ? 'grey' : 'idle'
      if (overall.available === 0) return 'red'
      if (overall.available < overall.total) return 'yellow'
      return 'green'
    }
    function accountsLine(snapshot) {
      var parts = ICON_PROVIDER_ORDER.map(function (providerId) {
        var found = snapshot.providers.find(function (p) {
          return p.providerId === providerId
        })
        if (found === undefined || found.tally.total === 0) return PROVIDER_SHORT_LABELS[providerId] + ' ' + NO_VALUE
        return PROVIDER_SHORT_LABELS[providerId] + ' ' + String(found.tally.available)
      })
      return '\u53ef\u7528\u8d26\u53f7 ' + String(snapshot.overall.available) + '/' + String(snapshot.overall.total)
        + '\uff08' + parts.join(' \u00b7 ') + '\uff09'
    }
    function rpmLine(budget) {
      var source = budget.sources[0]
      return '\u5168\u5c40 RPM ' + String(budget.admitRpm) + '\uff08' + (source === undefined ? NO_VALUE : source) + '\uff09'
    }
    function rpmLineUnattached() {
      return '\u5168\u5c40 RPM ' + NO_VALUE + '\uff08host \u672a\u8fd0\u884c\uff09'
    }
    function pointsLine(provider, fetchedAtLabel) {
      var used = provider.dailyUsedPts === undefined ? undefined : provider.dailyUsedPts.value
      var limit = provider.dailyLimitPts === undefined ? undefined : provider.dailyLimitPts.value
      if (used === null || used === undefined || limit === null || limit === undefined) {
        var reason = provider.usageUnavailableReason === undefined ? '\u65e0\u7528\u91cf\u7aef\u70b9'
          : provider.usageUnavailableReason === 'no-endpoint' ? '\u65e0\u7528\u91cf\u7aef\u70b9'
            : '\u4e0a\u6e38\u672a\u8fd4\u56de'
        return '\u4eca\u65e5 pts ' + NO_VALUE + '\uff08' + reason + '\uff09'
      }
      var base = '\u4eca\u65e5 pts ' + String(used) + ' / ' + String(limit)
      return fetchedAtLabel === null ? base : base + '\uff08\u622a\u81f3 ' + fetchedAtLabel + '\uff09'
    }
    function iconViewOf(input) {
      var snapshot = input.snapshot
      var attached = input.attached === undefined ? true : input.attached
      var counts = { available: snapshot.overall.available, total: snapshot.overall.total }
      var pointsProvider = input.pointsProviderId === null
        ? undefined
        : snapshot.providers.find(function (p) {
          return p.providerId === input.pointsProviderId
        })
      var points = pointsProvider === undefined || pointsProvider === null
        ? '\u4eca\u65e5 pts ' + NO_VALUE
        : pointsLine(pointsProvider, input.pointsFetchedAtLabel === undefined ? null : input.pointsFetchedAtLabel)
      var level = iconLevelOf(snapshot.overall, snapshot.overall.configured, attached)
      var lines = {
        accounts: attached ? accountsLine(snapshot) : '\u53ef\u7528\u8d26\u53f7 ' + NO_VALUE + '/' + NO_VALUE,
        rpm: attached ? rpmLine(input.budget) : rpmLineUnattached(),
        points: attached ? points : '\u4eca\u65e5 pts ' + NO_VALUE,
      }
      return {
        level: level,
        counts: counts,
        attached: attached,
        badge: attached ? String(counts.available) + '/' + String(counts.total) : NO_VALUE + '/' + NO_VALUE,
        lines: lines,
      }
    }
    function emptyView() {
      return iconViewOf({
        snapshot: {
          generatedAtMs: 0,
          accounts: [],
          providers: ICON_PROVIDER_ORDER.map(function (providerId) {
            return {
              providerId: providerId,
              tally: { available: 0, total: 0, providerId: providerId, configured: false },
              usageAvailable: false,
              err429LastHour: 0,
              err429ByKind: {},
            }
          }),
          overall: { available: 0, total: 0, providerId: 'all', configured: false },
          cooling: [],
          last5m: { requests: 0, err429: 0, rate: null },
          counters: { activeSessions: 0, queued: 0 },
        },
        budget: { admitRpm: 0, sources: [] },
        pointsProviderId: null,
        attached: false,
      })
    }
    // The one command the page sends, and what it hands back: a refusal from the host (which
    // resolves and carries the store's own words), or a failure to reach one.
    //
    // Three different things can go wrong here and they say three different words, because the
    // one thing a form must not do is turn "your key was refused" and "this build cannot save a
    // key" into the same grey sentence:
    //
    //   NO_WRITES       -- no channel, or no command() on it: the host predates T-2-e
    //   COMMAND_FAILED  -- command() threw, or rejected: the host is there and the call broke
    //
    // A refusal from the host itself is neither: it resolves, with `ok: false` and the store's
    // own reason, and passes through untouched including `message`.
    var NO_WRITES = 'no credential service'
    var COMMAND_FAILED = 'command failed'

    function commandOf(request) {
      var channel = typeof window === 'undefined' ? undefined : window[CHANNEL]
      if (channel === undefined || channel === null) {
        return Promise.resolve({ ok: false, reason: NO_WRITES })
      }
      if (typeof channel.command !== 'function') {
        return Promise.resolve({ ok: false, reason: NO_WRITES })
      }
      try {
        return Promise.resolve(channel.command(request)).catch(function (thrown) {
          return {
            ok: false,
            reason: COMMAND_FAILED,
            message: thrown instanceof Error ? thrown.message : String(thrown),
          }
        })
      } catch (thrown) {
        return Promise.resolve({
          ok: false,
          reason: COMMAND_FAILED,
          message: thrown instanceof Error ? thrown.message : String(thrown),
        })
      }
    }

    // The four states ride on host tokens that exist (dsh-doc references/ui-plugin.md), so a
    // light/dark switch repaints them without this file knowing a single colour value.
    var LEVEL_TOKEN = {
      green: '--dsw-alias-state-success-primary',
      yellow: '--dsw-alias-state-warn-primary',
      red: '--dsw-alias-state-error-primary',
      grey: '--dsw-alias-state-idle-primary',
      idle: '--dsw-alias-state-idle-primary',
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
      // idle is "never heard from the host", not "no keys": it wears the ring as an outline
      // instead of filling a dot, so switched-off and unconfigured stop looking the same.
      const idle = view.level === 'idle'
      const badge = React.createElement(
        'span',
        {
          'data-multipool-badge': view.level,
          'aria-hidden': true,
          style: small
            ? idle
              ? {
                  position: 'absolute',
                  right: -1,
                  bottom: -1,
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  boxSizing: 'border-box',
                  border: '1.5px solid ' + levelColor(view.level),
                  background: 'transparent',
                }
              : {
                  position: 'absolute',
                  right: -1,
                  bottom: -1,
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  background: levelColor(view.level),
                }
            : idle
              ? {
                  position: 'absolute',
                  right: -4,
                  bottom: -4,
                  padding: '0 2px',
                  borderRadius: 4,
                  boxSizing: 'border-box',
                  border: '1px solid ' + levelColor(view.level),
                  background: 'transparent',
                  color: levelColor(view.level),
                  fontSize: 9,
                  fontWeight: 600,
                  lineHeight: '12px',
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

    var PANEL_LABEL = 'DSH Multipool'

    /**
     * The main area, once the rail icon has been clicked.
     *
     * This task (B1) only promises the route: click, land, close, and nothing left over after a
     * disable. It deliberately draws no numbers, because there are none to draw yet -- the
     * account list, the RPM budget and the pts reading all arrive with their own task, and a
     * placeholder "0" here would be the same invented zero docs/05 section 2.3 and U-06 rule out
     * in the tooltip. So it says the one true thing it knows and stops.
     */
    function MultiPoolPanel() {
      const styles = {
        root: {
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          padding: '24px 20px',
          color: 'var(--dsw-alias-label-primary)',
          fontSize: 13,
          lineHeight: '20px',
          maxWidth: 520,
        },
        title: {
          fontSize: 15,
          fontWeight: 600,
        },
        body: {
          color: 'var(--dsw-alias-label-secondary)',
        },
      }
      return React.createElement(
        'div',
        { style: styles.root, 'data-multipool-panel': 'true' },
        React.createElement('div', { style: styles.title }, 'AMD \u8d26\u53f7\u6c60'),
        React.createElement(
          'div',
          { style: styles.body },
          '\u672c\u673a\u8fd8\u6ca1\u6709\u8bfb\u5230\u4efb\u4f55\u8d26\u53f7\u3002\u6dfb\u52a0\u4e00\u4e2a AMD Token Factory \u7684 API Key \u4e4b\u540e\uff0c\u8fd9\u91cc\u4f1a\u663e\u793a\u8d26\u53f7\u7684\u53d6\u7528\u72b6\u6001\u4e0e\u4f59\u91cf\u3002',
        ),
      )
    }

    return {
      // docs/05 section 2: inject so the slot owner can call us again after a remount, and
      // register inside ctx.effect so disabling the plugin unregisters instead of leaving a
      // ghost behind for the next enable to paint over (06 T-2-b DoD).
      inject: ['slots'],
      // Handed out for the parity test only: nothing on the page can see this property, and the
      // loader asks the factory for `inject`/`apply`. Without it the page's copy of commandOf()
      // would be the one function in this file no test ever calls.
      commandOf: commandOf,
      apply(ctx) {
        // The icon and the panel are one feature, not two: sidebar's README, the "global panel entry" section,
        // says a sidebar id addresses the main keyed slot's entry of that same id, and layout
        // looks the row up as entriesOfSlot('main').find(e => e.options.key === id). An icon
        // registered alone therefore paints a row that selects itself and lands on nothing --
        // which is exactly the grey, unclickable dot a fresh install used to show.
        //
        // Both live inside their own ctx.effect so the pair unregisters together. Layout's
        // retainMainPanels is subscribed to 'main', so dropping the panel hands the main area
        // back to 'conversation' instead of leaving an empty keyed cell behind.
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.effect(() =>
            ctx.slots.register(
              {
                name: 'sidebar.panellist',
                id: 'dsh-multipool',
                order: 30,
                label: PANEL_LABEL,
              },
              SidebarIcon,
            ),
          ),
        )
        ctx.slots.inject('main', () =>
          ctx.effect(() =>
            ctx.slots.register(
              {
                name: 'main',
                key: 'dsh-multipool',
                label: PANEL_LABEL,
              },
              MultiPoolPanel,
            ),
          ),
        )
      },
      // Held out to the tests so icon-state.test.ts can put this copy and the TypeScript one
      // on the same inputs. Module-loader does not require this module to implement a fixed
      // interface; these are no more visible to the page than the functions themselves were.
      iconLevelOf: iconLevelOf,
      iconViewOf: iconViewOf,
      emptyView: emptyView,
    }
  },
})
