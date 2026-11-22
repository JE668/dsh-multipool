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
 * The host half runs in a different process. Two designs for the seam between them are gone: a
 * window key, which the halves do not share because globalThis is one per process (the tests passed
 * by handing both halves the same global), and the connection service, which DSH provides inside its
 * own client bundle and therefore hands to none of the plugins a profile loads. What both processes
 * do have is the renderer's window, so the request is an event on it:
 *
 *   dispatch  BRIDGE_EVENT  { callId, endpoint: 'snapshot', payload }  -> { ok: true, value: IconView }
 *   dispatch  BRIDGE_EVENT  { callId, endpoint: 'command',  payload: { request } }
 *                        -> { ok: true, value: CommandOutcome }
 *
 * The call is the request. There is no subscribe: the icon asks when it paints, and the panel asks
 * when it is opened, which is the only moment either answer is looked at. A host that is not
 * running never dispatches a reply, the callId never comes back, and the timeout is the dash.
 *
 * Until a snapshot arrives the icon paints the empty pool: idle, --/--, three dashes. That is the
 * right answer for a fresh install, and for a host that is not running it is the only answer we
 * have that is not a guess.
 */
window.__ModuleLoader__.load({
  id: 'dsh-multipool',
  factory(require) {
    const React = require('react')
    // Spelled exactly as the Host half spells them (packages/plugin-dsh/src/channel.ts); nothing
    // can check that at runtime except this file and its test, which is why they are re-typed.
    var ENDPOINT_SNAPSHOT = 'snapshot'
    var ENDPOINT_COMMAND = 'command'
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
    // One word for both ways of not reaching it. A page cannot act on the difference -- "no
    // credential service" and "the call threw" support the same single action, try again once
    // whatever was wrong is fixed -- and two words meant two branches for a caller to keep, or (as
    // happened) one branch quietly folded into the other and a test that could no longer tell which
    // path it had walked. The host's own refusal is the one verdict that survives, because that is
    // the one a form can put next to the field: it arrives as a resolved envelope with ok: true --
    // the call was answered -- and the store's words inside, so it passes through untouched.
    var NO_WRITES = 'no credential service'

    // Host and page are two processes, but in DSH desktop they share one renderer, and the
    // window is the object both of them can reach. The channel used to be `connection.rpc`, which
    // the page provides only to DSH's own client bundle -- a plugin loaded from a profile got
    // nothing and drew dashes over a host that was running. Two events need no provider.
    //
    // What that trades away: a window event carries no authentication. Any script already on
    // the page could answer in the host's place. Nothing below treats an answer as proof of
    // anything; it is printed, and the printing is where it is checked (docs/09).
    var BRIDGE_EVENT = 'dsh-multipool:bridge'
    var BRIDGE_REPLY = 'dsh-multipool:bridge-reply'
    var CALL_TIMEOUT_MS = 4000

    /** The window the bridge speaks on, or undefined where there is none. */
    function bridgeOf() {
      if (typeof window === 'undefined') return undefined
      if (window === null) return undefined
      if (typeof window.addEventListener !== 'function') return undefined
      if (typeof window.dispatchEvent !== 'function') return undefined
      return window
    }

    /**
     * The question, as the bus wants it: a real Event, not an object shaped like one.
     *
     * dispatchEvent is specified to refuse anything that is not an Event, and a browser enforces
     * it -- our window stub did not, so the bridge looked wired while every single call refused on
     * arrival with "parameter 1 is not of type 'Event'". CustomEvent is where `detail` lives at all;
     * Event has no such member. The detail is a fresh object so a listener cannot rewrite the ask.
     */
    function askOf(callId, endpoint, payload) {
      return new CustomEvent(BRIDGE_EVENT, {
        detail: { callId: callId, endpoint: endpoint, payload: payload },
      })
    }

    var callCount = 0

    /**
     * One endpoint, asked on the window and answered on the window.
     *
     * The callId keeps two asks apart: both halves share one bus, so a reply is matched to its
     * own request rather than to whatever came back first. The promise rejects -- never resolves
     * undefined -- when there is no window, when nothing answered in time, or when the answer was
     * a refusal, so callers keep just two branches: the host said no, or no host was listening.
     */
    function request(endpoint, payload) {
      var bridge = bridgeOf()
      if (bridge === undefined) return Promise.reject(new Error(NO_WRITES))
      callCount += 1
      var callId = 'multipool-' + String(callCount)
      return new Promise(function (keep, fail) {
        var settled = false
        var timer = null
        function answer(event) {
          if (settled) return
          var detail = event === null || event === undefined ? undefined : event.detail
          if (detail === null || detail === undefined || typeof detail !== 'object') return
          if (detail.callId !== callId) return
          settled = true
          clearTimeout(timer)
          bridge.removeEventListener(BRIDGE_REPLY, answer)
          if (detail.ok === true) {
            keep(detail.value)
            return
          }
          var said = detail.error === null || detail.error === undefined ? undefined : detail.error.message
          fail(new Error(said === undefined ? NO_WRITES : String(said)))
        }
        timer = setTimeout(function () {
          if (settled) return
          settled = true
          bridge.removeEventListener(BRIDGE_REPLY, answer)
          fail(new Error(NO_WRITES))
        }, CALL_TIMEOUT_MS)
        bridge.addEventListener(BRIDGE_REPLY, answer)
        bridge.dispatchEvent(askOf(callId, endpoint, payload))
      })
    }

    /**
     * TEMPORARY (T-2-b): what the bridge said, in its own words.
     *
     * viewOf() has one failure answer -- the empty pool -- because the icon must paint
     * something. That makes 'the listener is not attached' and 'the host answered nothing'
     * the same three dashes on screen. This asks again and keeps the reply, or the refusal, so
     * that one restart can tell the two apart. Delete it with the probe row that prints it.
     */

    var NO_TRACE = 'render only / build 225e244'
    var traceStep = NO_TRACE

    function traceOf() {
      // Reports the step it reached instead of the answer it wanted, because the answer is what
      // never arrived. A promise chain cannot say "I stopped between two and three"; a module-level
      // string that each step overwrites can, and whatever the screen shows is the last step reached.
      if (bridgeOf() === undefined) {
        traceStep = '1 no window'
        return Promise.resolve(traceStep)
      }
      callCount += 1
      var callId = 'multipool-' + String(callCount)
      return new Promise(function (settle) {
        traceStep = '3 listener installed'
        var timer = setTimeout(function () {
          settle(traceStep + ' ; no reply in ' + String(CALL_TIMEOUT_MS) + 'ms')
        }, CALL_TIMEOUT_MS)
        function answer(event) {
          var detail = event === null || event === undefined ? undefined : event.detail
          var mine =
            detail !== null && detail !== undefined && typeof detail === 'object'
              ? 'detail ' + String(detail.callId) + ' ok ' + String(detail.ok)
              : 'no detail'
          traceStep = '4 heard ' + mine
          settle(traceStep)
          clearTimeout(timer)
        }
        window.addEventListener(BRIDGE_REPLY, answer)
        traceStep = '5 dispatched'
        window.dispatchEvent(askOf(callId, ENDPOINT_SNAPSHOT, {}))
        traceStep = '6 dispatch returned'
      })
    }

    /**
     * The one command the page sends, and what it hands back.
     *
     * `ask` keeps one branch for "the host said no" and one for "the host was not there to say
     * anything", and both of them are undefined-shaped at this line: the caller's next step is
     * the same either way, so the difference is carried by the probe row, not by a second field.
     */
    function ask(endpoint, payload) {
      return request(endpoint, payload).then(
        function (answer) {
          return answer
        },
        function (thrown) {
          // No host, no answer, no story to tell.
          return undefined
        },
      )
    }

    function failed(thrown) {
      return {
        ok: false,
        reason: COMMAND_FAILED,
        message: thrown instanceof Error ? thrown.message : String(thrown),
      }
    }

    /**
     * The one command the page sends, and what it hands back.
     *
     * `ask` keeps one branch for "the host said no" and one for "the host was not there to say
     * anything", and both of them are undefined-shaped at this line: the caller's next step is
     * the same either way, so the difference is carried by the probe row, not by a second field.
     */
    function ask(endpoint, payload) {
      return request(endpoint, payload).then(
        function (answer) {
          return answer
        },
        function (thrown) {
          // No host, no answer, no story to tell.
          return undefined
        },
      )
    }

    function failed(thrown) {
      return {
        ok: false,
        reason: COMMAND_FAILED,
        message: thrown instanceof Error ? thrown.message : String(thrown),
      }
    }

    /** Send the one command the page has, and hand back what the host says about it. */
    function commandOf(request) {
      return ask(ENDPOINT_COMMAND, { request: request }).then(function (outcome) {
        if (outcome === undefined || outcome === null) return failed(new Error(NO_WRITES))
        return outcome
      })
    }

    /**
     * The one command the page sends, and what it hands back.
     *
     * `ask` keeps one branch for "the host said no" and one for "the host was not there to say
     * anything", and both of them are undefined-shaped at this line: the caller's next step is
     * the same either way, so the difference is carried by the probe row, not by a second field.
     */
    function ask(endpoint, payload) {
      return request(endpoint, payload).then(
        function (answer) {
          return answer
        },
        function (thrown) {
          // No host, no answer, no story to tell.
          return undefined
        },
      )
    }

    function failed(thrown) {
      return {
        ok: false,
        reason: COMMAND_FAILED,
        message: thrown instanceof Error ? thrown.message : String(thrown),
      }
    }

    var COMMAND_FAILED = 'command failed'
    var LEVEL_TOKEN = {
      green: '--dsw-alias-state-success-primary',
      yellow: '--dsw-alias-state-warn-primary',
      red: '--dsw-alias-state-error-primary',
      grey: '--dsw-alias-state-idle-primary',
      idle: '--dsw-alias-state-idle-primary',
    }

    /** Send the one command the page has, and hand back what the host says about it. */
    function commandOf(request) {
      return ask(ENDPOINT_COMMAND, { request: request }).then(function (outcome) {
        if (outcome === undefined || outcome === null) return failed(new Error(NO_WRITES))
        return outcome
      })
    }

    /** The icon view the host is answering with right now, or the empty pool if it is not. */
    function viewOf() {
      return ask(ENDPOINT_SNAPSHOT, {}).then(
        function (view) {
          return view === undefined || view === null ? emptyView() : view
        },
        function () {
          // No host, no answer, no story to tell: the icon's own empty pool already says "nothing
          // read yet", and a reason string here would only be a second place to keep it in sync.
          return emptyView()
        },
      )
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
        var live = true
        viewOf().then(function (next) {
          // A row that unmounted before the answer came back must not set state on a gone tree.
          if (live) setView(next)
        })
        return function () {
          live = false
        }
      }, [])

      const small = props.size <= 16
      const title = view.lines.accounts + '\n' + view.lines.rpm + '\n' + view.lines.points

      // Sidebar renders this row at 16px expanded and 18px collapsed -- not the 24px that
      // docs/05 section 2.1 draws, which is the slot rather than the prop. A threshold keyed on
      // a 24px assumption therefore never fired, and every rail kept a bordered text box
      // where docs/05 describes a dot. The corner keeps its fraction in the tooltip.
      //
      // Which is why the size is not a literal here: both it and the border are, and idle changes
      // both at once. A hollow ring of the same 6px reads thinner than a filled dot does the moment
      // the dot sits on a light background, so idle draws one ring-size larger with a transparent
      // centre -- an outline, not a smaller hole.
      const idle = view.level === 'idle'
      const corner = small ? (idle ? 8 : 6) : 14
      const badge = React.createElement(
        'span',
        {
          'data-multipool-badge': view.level,
          'aria-hidden': true,
          style: {
            position: 'absolute',
            right: small ? -1 : -4,
            bottom: small ? -1 : -4,
            width: corner,
            height: corner,
            boxSizing: 'border-box',
            borderRadius: corner / 2,
            // An unheard host has no fraction to print, so it prints none: idle is the one level
            // drawn hollow. Every other level fills, because every other level is a count.
            border: idle ? (small ? '1.5px solid ' : '1px solid ') + levelColor('idle') : undefined,
            background: idle ? 'transparent' : levelColor(view.level),
            color: idle ? levelColor('idle') : undefined,
            fontSize: idle ? 9 : undefined,
            fontWeight: idle ? 600 : undefined,
            lineHeight: idle ? '12px' : undefined,
            textAlign: idle ? 'center' : undefined,
          },
        },
        idle || small ? undefined : String(view.counts.available),
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
      // Same channel, same absence rule as the rail icon: no host, emptyView, and emptyView
      // carries dashes rather than zeros. One snapshot, two views.
      const pair = React.useState(emptyView)
      const view = pair[0]
      const setView = pair[1]
      const tracePair = React.useState(function () { return NO_TRACE })
      const trace = tracePair[0]
      const setTrace = tracePair[1]

      React.useEffect(function () {
        var live = true
        // Written synchronously, before any promise: whatever the bridge answers, the fact that
        // this effect ran arrives first, and a rejected chain cannot swallow it.
        setTrace('effect ran / build 225e244')
        traceOf().then(function (said) {
          if (live) setTrace(said)
        })
        viewOf().then(function (next) {
          // A row that unmounted before the answer came back must not set state on a gone tree.
          if (live) setView(next)
        })
        return function () {
          live = false
        }
      }, [])

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
        line: {
          color: 'var(--dsw-alias-label-primary)',
          whiteSpace: 'pre-wrap',
          fontVariantNumeric: 'tabular-nums',
        },
        note: {
          color: 'var(--dsw-alias-label-tertiary)',
          fontSize: 12,
        },
      }

      const rows = [
        React.createElement('div', { key: 'accounts', style: styles.line, 'data-multipool-line': 'accounts' }, view.lines.accounts),
        React.createElement('div', { key: 'rpm', style: styles.line, 'data-multipool-line': 'rpm' }, view.lines.rpm),
        React.createElement('div', { key: 'points', style: styles.line, 'data-multipool-line': 'points' }, view.lines.points),
      ]

      const children = [
        React.createElement('div', { key: 'title', style: styles.title },
          'AMD \u8d26\u53f7\u6c60'),
        React.createElement('div', { key: 'rows' }, rows),
        // TEMPORARY (A of the two options): the verbatim outcome of one direct call, so a
        // restart can tell a missing route from a refused one. Both look like three dashes
        // above. Delete this line -- and traceOf/NO_TRACE with it -- once they are told apart.
        React.createElement(
          'div',
          { key: 'trace', style: styles.note, 'data-multipool-trace': 'true' },
          String(trace),
        ),
      ]

      return React.createElement(
        'div',
        {
          style: styles.root,
          'data-multipool-panel': 'true',
          'data-multipool-level': view.level,
          'data-multipool-attached': view.attached ? 'true' : 'false',
        },
        children,
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
