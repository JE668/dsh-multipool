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
 * The host half runs in a different process. Three designs for the seam between them are gone:
 * a window key, which the halves do not share because globalThis is one per process (the tests
 * passed by handing both halves the same global); window events, which the page did dispatch and
 * the host never heard because they are two very different windows; and connection.rpc, which DSH
 * provides inside its own client bundle and therefore hands to none of the plugins a profile
 * loads. What is left is the thing this page is actually served over: the host's web server.
 *
 *   POST  /dsh-multipool/snapshot  {}                 -> { ok: true, value: IconView }
 *   POST  /dsh-multipool/command   { request }       -> { ok: true, value: CommandOutcome }
 *
 * A relative path is the whole trick. In DSH desktop this page is served from dsh-app://app, and
 * every fetch it makes that is not one of the shell's own files is handed by protocol.handle to
 * forwardWebRequest -- which reissues it against the host's web server with the Host's cookie
 * attached, and only from this origin. So the request below names no port and sets no credential:
 * it asks its own origin, the shell forwards, and connection.admit decides. A page with no host
 * answers 404 or not at all, and both land on the same three dashes.
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

    // The third word: whether the host has counted the pool at all.
    // 'unread' and 'empty' are not the same claim, and 0/0 must not stand for both.
    function accountsUnread() {
      return '\u53ef\u7528\u8d26\u53f7 ' + NO_VALUE + '/' + NO_VALUE
    }
    function notReadYet() {
      return '\u6ca1\u8bfb\u8fc7\u8d26\u53f7\u6c60'
    }
    function hostUnreachable() {
      return 'host ' + '\u672a\u8fd0\u884c'
    }

    function iconLevelOf(overall, configured, attached, reading) {
      var heard = attached === undefined ? true : attached
      if (!heard) return 'idle'
      // Nobody has looked: 'unread' is not an empty pool, and must not borrow its colour.
      if (reading === 'unread') return 'idle'
      if (!configured || overall.total === 0) return 'grey'
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
    function rpmLineUnattached(reason) {
      return '\u5168\u5c40 RPM ' + NO_VALUE + '\uff08' + reason + '\uff09'
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
      var reading = input.reading === undefined ? 'unread' : input.reading
      var counts = { available: snapshot.overall.available, total: snapshot.overall.total, reading: reading }
      var pointsProvider = input.pointsProviderId === null
        ? undefined
        : snapshot.providers.find(function (p) {
          return p.providerId === input.pointsProviderId
        })
      var points = pointsProvider === undefined || pointsProvider === null
        ? '\u4eca\u65e5 pts ' + NO_VALUE
        : pointsLine(pointsProvider, input.pointsFetchedAtLabel === undefined ? null : input.pointsFetchedAtLabel)
      var level = iconLevelOf(snapshot.overall, snapshot.overall.configured, attached, reading)
      var unread = reading === 'unread'
      var lines = {
        accounts: !attached || unread ? accountsUnread() : accountsLine(snapshot),
        rpm: attached && !unread ? rpmLine(input.budget) : rpmLineUnattached(unread ? notReadYet() : hostUnreachable()),
        points: !attached || unread ? '\u4eca\u65e5 pts ' + NO_VALUE : points,
      }
      return {
        level: level,
        counts: counts,
        attached: attached,
        // A host that answered "I have not looked" has a badge in the same sense a switched-off
        // drawer does: the digits exist, and none of them were asked for.
        badge: !attached || unread ? NO_VALUE + '/' + NO_VALUE : String(counts.available) + '/' + String(counts.total),
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
        reading: 'unread',
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

    // The page asks over HTTP, because HTTP is the one thing both processes are already speaking.
    // What this trades away: there is no push. A page asks-path -> gets a snapshot -> that snapshot
    // stands for ever, or until the page asks again. Nothing on the host side pushes when it changes.
    var CHANNEL = '/dsh-multipool'
    var CALL_TIMEOUT_MS = 4000

    /**
     * One endpoint, asked over HTTP and answered as JSON.
     *
     * A relative path, so the origin is whatever served this page: in DSH desktop that is
     * dsh-app://app, whose protocol handler forwards everything that is not a shell file to the
     * host's web server with the host's cookie already attached (docs/09 section 6.1.1). This file
     * names no port and sets no credential, and if it ever had to, it would be wrong -- the port
     * is the host's, chosen at listen time, and the cookie is not ours to read.
     *
     * The promise rejects, never resolves undefined, on: no fetch to call with, no answer inside
     * CALL_TIMEOUT_MS, an answer that is not ok, an answer that is not JSON, or an answer that is JSON
     * but not an envelope. Callers keep two branches -- the host said no, or the host was not heard
     * from -- and both of them arrive here as the second.
     */
    function request(endpoint, payload) {
      if (typeof fetch !== 'function') return Promise.reject(new Error(NO_WRITES))
      var url = CHANNEL + '/' + endpoint
      var cancel = typeof AbortController === 'function' ? new AbortController() : undefined
      var timer =
        cancel === undefined
          ? undefined
          : setTimeout(function () {
            cancel.abort()
          }, CALL_TIMEOUT_MS)
      function stop() {
        if (timer !== undefined) clearTimeout(timer)
      }
      var sent
      try {
        sent = fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload === undefined ? {} : payload),
          credentials: 'same-origin',
          signal: cancel === undefined ? undefined : cancel.signal,
        })
      } catch (thrown) {
        // fetch() rejects for a host that is not running, and throws only for a call it could not
        // make at all. Both are 'no answer', and the chain below only knows how to continue one.
        stop()
        return Promise.reject(thrown)
      }
      return sent
        .then(
          function (response) {
            if (response.ok === true) return response.text()
            throw new Error('HTTP ' + String(response.status))
          },
          function (thrown) {
            throw new Error(thrown instanceof Error ? thrown.message : String(thrown))
          },
        )
        .then(function (text) {
          stop()
          var answer
          try {
            answer = JSON.parse(text)
          } catch {
            throw new Error(NO_WRITES)
          }
          if (answer === null || typeof answer !== 'object') throw new Error(NO_WRITES)
          if (answer.ok === true) return answer.value
          var said = answer.error === null || answer.error === undefined ? undefined : answer.error.message
          throw new Error(said === undefined ? NO_WRITES : String(said))
        })
    }

    /**
     * What the wire said, in its own words.
     *
     * viewOf() has one failure answer -- the empty pool -- because the icon must paint something.
     * That makes 'nobody answered' and 'somebody refused' the same three dashes on screen: a
     * distinction the screen cannot show and a support session cannot ask for. This carries the
     * other answer, verbatim, in the panel's fourth row. TEMPORARY -- delete it, the row, and the
     * styles.note it borrows when the icon paints a real pool on a real install.
     */
    var NO_TRACE = 'render only / build 47f1098'

    function traceOf() {
      if (typeof fetch !== 'function') return Promise.resolve('1 no fetch on this page')
      var url = CHANNEL + '/' + ENDPOINT_SNAPSHOT
      return Promise.resolve()
        .then(function () {
          return fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}',
            credentials: 'same-origin',
          })
        })
        .then(
          function (response) {
            return response.text().then(function (text) {
              return (
                '2 answered HTTP ' +
                String(response.status) +
                ' in ' +
                String(text.length) +
                ' chars: ' +
                text.slice(0, 120)
              )
            })
          },
          function (thrown) {
            return '2 refused: ' + (thrown instanceof Error ? thrown.message : String(thrown))
          },
        )
    }

    /**
     * request(), with the reason kept -- the shape the two callers below actually want.
     *
     * The reason is the only thing that tells a refusal apart from a silence, so it is not dropped
     * here; it travels as ok:false, which is the same envelope the host sends when it says no. The
     * sentence is the host's or the transport's, unchanged: rewriting 'the store says no' into 'no
     * credential service' would report a different bug than the one happening.
     */
    function ask(endpoint, payload) {
      return request(endpoint, payload).then(
        function (value) {
          return value
        },
        function (thrown) {
          return failed(thrown)
        },
      )
    }

    /** The envelope a refusal travels in, so a caller can tell one from a silence. */
    function failed(thrown) {
      return {
        ok: false,
        reason: COMMAND_FAILED,
        message: thrown === null || thrown === undefined ? NO_WRITES : String(thrown.message === undefined ? thrown : thrown.message),
      }
    }

    /** Send the one command the page has, and hand back what the host says about it. */
    function commandOf(request) {
      return ask(ENDPOINT_COMMAND, { request: request }).then(function (outcome) {
        if (outcome === undefined || outcome === null) return failed(new Error(NO_WRITES))
        return outcome
      })
    }

    /** The view the icon and the panel both paint, asked for once per render. */
    function viewOf() {
      return ask(ENDPOINT_SNAPSHOT, {}).then(
        function (answer) {
          // { view, reading }: the reading travels beside the numbers, because a 0/0 the host
          // never counted and a 0/0 it counted are the same five characters on screen.
          if (answer === undefined || answer === null || answer.view === undefined) return emptyView()
          return iconViewOf({ snapshot: answer.view, attached: true, reading: answer.reading })
        },
        function () {
          // No host, no answer, no story to tell: the icon's own empty pool already says "nothing
          // read yet", and a reason string here would only be a second place to keep it in sync.
          return emptyView()
        },
      )
    }

    var COMMAND_FAILED = 'command failed'
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
