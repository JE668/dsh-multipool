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
    // Not a command: a read of its own kind, answered where the source is rather than where the
    // write seam is. It has to keep working on an install with no credential service at all, and
    // a write route would not -- commandOf() would return "no credential service" for it.
    var ENDPOINT_TEST = 'test'
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

    /** The rail and the panel went over HTTP; the key goes over the same route. Two write words only. */
    var SAVE = 'save'
    var FORGET = 'forget'

    /** Four places a credential can live, in the words docs/02 section 1.9 uses for them. */
    var SETTINGS = {
      title: 'AMD Token Factory \u7684 API Key',
      intro: '\u5b58\u5728\u672c\u673a\u7684\u51ed\u8bc1\u91cc\uff0c\u4e0d\u5199\u914d\u7f6e\u6587\u4ef6\uff0c\u4e0d\u8fdb\u4ed3\u5e93\u3002\u9875\u9762\u4e0d\u4f1a\u628a\u5b83\u8bfb\u56de\u6765\u3002',
      placeholder: 'rc-\u2026',
      save: '\u4fdd\u5b58',
      saving: '\u6b63\u5728\u4fdd\u5b58',
      forget: '\u5fd8\u6389\u8fd9\u628a\u94a5\u5319',
      forgetting: '\u6b63\u5728\u5fd8\u8bb0',
      test: '\u6d4b\u8bd5\u8fde\u63a5',
      testing: '\u6b63\u5728\u8bf7\u6c42\u4e0a\u6e38',
      // Two sentences for the two ways a test can end without a number. Neither is an error,
      // and neither is a zero: one says the button refused itself, the other says the upstream
      // answered with nothing this page may read.
      tooSoon: '\u4e0a\u4e00\u6b21\u8bf7\u6c42\u8fd8\u4e0d\u5230\u4e00\u5206\u949f\uff0c\u8fd9\u6b21\u6ca1\u53d1\uff08\u4e0a\u6e38\u9650\u4e00\u5206\u949f\u4e00\u6b21\uff09',
      reached: '\u4e0a\u6e38\u5df2\u56de\u7b54\uff0c\u4f46\u6ca1\u5e26\u56de\u7528\u91cf\u6570\u5b57',
      reading: '\u4e0a\u6e38\u56de\u7b54\uff1a',
      // Said after a bare count only when the layer is known, and after a carried count always:
      // the first reading the reader did not watch arrive, they only saw where it landed.
      carried: '\u2014\u7231\u7528\u4e0a\u4e00\u6b21\u8bfb\u6570\uff08\u4e00\u5206\u949f\u5185\u53ea\u95ee\u4e00\u6b21\uff09',
      // The third sentence, for "the host answered nothing at all" -- a dead route, not a dead key.
      unreachable: '\u6ca1\u6709\u6536\u5230\u4e0a\u6e38\u7684\u56de\u7b54',
      unread: '\u672c\u673a\u8fd8\u6ca1\u8bfb\u8fc7',
      stored: '\u5df2\u5b58\u5728\u672c\u673a',
      inLayer: '\uff08',
      notStored: '\u672c\u673a\u8fd8\u6ca1\u6709\u5b58',
      // The right bracket closes here, not at the one caller: inLayer opens "(" and these four
      // close it, so a second place cannot print "stored (config file" for ever. If the seam cannot
      // name a layer, layerWord answers nothing and no bracket was opened.
      inFile: '\u914d\u7f6e\u6587\u4ef6\uff09',
      inEnv: '\u73af\u5883\u53d8\u91cf\uff09',
      inProjectEnv: '\u9879\u76ee\u73af\u5883\u53d8\u91cf\uff09',
      inUserEnv: '\u7528\u6237\u73af\u5883\u53d8\u91cf\uff09',
      note: '\u5e76\u53d1 8 \u4e0e RPM 20 \u6765\u81ea docs/02 section 1.1 \u4e0e section 1.4\uff0c\u4ee5\u4e0a\u6e38\u56de\u6267\u4e3a\u51c6\u3002\u4f59\u989d\u53ea\u80fd\u4ece GET /v1/usage \u8bfb\uff0c\u4e0d\u5728\u8fd9\u4e00\u9875\u7b97\u3002',
    }

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
    function sentenceOf(answer) {
      if (answer === undefined || answer === null) {
        return SETTINGS.unreachable
      }
      // A primitive is the host's own sentence about a test it could not perform -- on an install
      // with no credential service, say. It is still a sentence, so it is printed.
      if (typeof answer !== 'object') return String(answer)
      // ask() folds a transport failure into { ok: false, reason, message }. That envelope is this
      // page's own sentence about a host it could not reach, and the only one it may add itself:
      // nothing crossed the wire, so there is nothing to quote.
      if (answer.ok === false) {
        return answer.message === undefined || answer.message === null
          ? SETTINGS.unreachable
          : String(answer.message)
      }
      // Otherwise it is a UsageAttempt, carried under `value`. A test that could not even be
      // attempted has no usage to show; it has the host's `said`, and that is the one thing the
      // button exists to display.
      // ask() hands back whatever the host put under `value`, already unwrapped -- so `answer`
      // itself IS the attempt itself here. The snapshot endpoint is the one that answers an
      // object with `.view` on it, and reading `answer.value` in both places is how `viewOf()` lost
      // a whole round to three dashes.
      var attempt = answer
      if (attempt.tooSoon === true) return SETTINGS.tooSoon
      // The upstream's own words, never a summary of them.
      if (typeof attempt.said === 'string' && attempt.said !== '') return attempt.said
      // A carried reading comes before the count, not after it: the number below is the one a
      // minute ago bought, and introducing it as the upstream's answer would be the same lie the
      // "answered but brought back no number" sentence told, only quieter.
      var carrier =
        attempt.carried === true && typeof attempt.atMs === 'number' && isFinite(attempt.atMs)
          ? SETTINGS.carried
          : ''
      var usage = attempt.usage
      if (usage === undefined || usage === null) return SETTINGS.reached
      var used = usage.dailyUsedPts
      var limit = usage.dailyLimitPts
      if (used === undefined || used === null) return SETTINGS.reached
      if (limit === undefined || limit === null) return SETTINGS.reached
      // pts are pts (docs/02 section 1.3), not dollars: the field names say _usd and that is a trap
      // this line has to avoid, not repeat.
      //
      // The layer is not appended here. The where line already carries where the key lives, and a
      // second telling after the number reads as a fact about the number -- "0.59 pts, in the config
      // file" -- which is the one thing a reading of the number must not imply.
      return carrier + SETTINGS.reading + ' ' + ptsOf(used.value) + ' / ' + ptsOf(limit.value) + ' pts'
    }

    /**
     * One number, as a person reads it (docs/05 section 2.3).
     *
     * The upstream answers 0.19718791934428737 because it is a float, not because it is that
     * precise; printing every digit it happened to carry is a claim about accuracy nobody made.
     * Two decimals is where the upstream's own USD figure stops meaning anything, and trailing
     * zeros are dropped so that 0.50 does not read as a finer measurement than 0.5.
     */
    function ptsOf(value) {
      if (typeof value !== 'number' || !isFinite(value)) return String(value)
      var fixed = value.toFixed(2)
      return fixed.replace(/\.?0+$/, '') || '0'
    }

    /** The sentence the test button prints: the host's, or this page's for a host that is not there. */
    function testOf() {
      // No payload: a test names no provider unless somebody above it says so, and the host's
      // default is the one this icon prints numbers for.
      return ask(ENDPOINT_TEST).then(sentenceOf)
    }
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
          body: JSON.stringify(payload === undefined ? null : payload),
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

    /**
     * The host's sentence for one upstream reading, flattened to a line of text.
     *
     * Three of the sentences here are this page's own, and only three are allowed: 'unreachable'
     * for no answer at all, 'tooSoon' when the host declined to ask again, and the host's message
     * for a refusal it documented. Everything else is quoted, because a summary of somebody else's
     * error is a new error.
     */

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
          // Paint what the host computed; do not compute it again. view is already an IconView --
          // level, counts, badge and lines -- and re-deriving one here needs a Snapshot, which this
          // is not:
          //
          //     iconViewOf({ snapshot: answer.view })   // answer.view.overall === undefined
          //
          // That threw, ask() caught the throw as a refusal, and viewOf() painted the refusal as the
          // placeholder -- so every real answer showed as three dashes while the wire was green.
          // The layer rides on the view's object, not beside it in a second return value: the
          // settings page is the only reader, and every other caller already treats what comes
          // back here as an opaque IconView. Added only when the host sent one, so a host that
          // never reports layers is distinguishable from one that reported none.
          if (answer.layer !== undefined) answer.view.layer = answer.layer
          return answer.view
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
    /**
     * viewOf(), asked again on a timer until told to stop.
     *
     * The reading lives in the host process: it is produced by whatever wrote the key, and nothing
     * carries a change back across the boundary -- an HTTP route answers, it does not call. So a view
     * fetched once is the state at that instant, for ever, which is how the rail came to paint "not
     * read" while the pool behind it already held a key.
     *
     * The interval is the page's own rendering clock, not a budget: it reaches our own web server and nothing
     * upstream, so it does not count against rpmAccount, rpmKey or the sixty-second window in docs/04
     * section 2. If that ever stops being true, this is the line that is wrong.
     */
    var VIEW_REFRESH_MS = 5000

    function follow(keep) {
      var live = true
      var tick = function () {
        if (!live) return
        viewOf().then(function (next) {
          if (live) keep(next)
        })
      }
      tick()
      var timer = setInterval(tick, VIEW_REFRESH_MS)
      return function () {
        live = false
        clearInterval(timer)
      }
    }
    /**
     * Which word names the layer the seam reported -- or none, for a layer this page has no word
     * for.
     *
     * Returning "cannot tell which layer" would put it inside the brackets that only open when the
     * seam did name one: "stored here (cannot tell which layer)" contradicts itself in five words.
     * A name this page does not know is a name it has nothing to add about, and the sentence before
     * the bracket already said the true and useful thing.
     */
    function layerWord(layer) {
      if (layer === 'file') return SETTINGS.inFile
      if (layer === 'env') return SETTINGS.inEnv
      if (layer === 'project-env') return SETTINGS.inProjectEnv
      if (layer === 'user-env') return SETTINGS.inUserEnv
      return ''
    }

    // Same three shapes the panel above uses, so the settings page reads as one more page of this
    // app rather than as a form that arrived from somewhere else.
    var settingsStyles = {
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
      note: {
        color: 'var(--dsw-alias-label-tertiary)',
        fontSize: 12,
        lineHeight: '18px',
        whiteSpace: 'pre-wrap',
      },
      where: {
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: 12,
        lineHeight: '18px',
      },
      field: {
        boxSizing: 'border-box',
        width: '100%',
        padding: '6px 8px',
        border: '1px solid var(--dsw-alias-border-secondary)',
        borderRadius: 6,
        background: 'var(--dsw-alias-bg-base)',
        color: 'var(--dsw-alias-label-primary)',
        fontFamily: 'var(--dsw-font-mono)',
        fontSize: 12,
      },
      actions: {
        display: 'flex',
        gap: 8,
      },
      button: {
        padding: '4px 10px',
        border: '1px solid var(--dsw-alias-border-secondary)',
        borderRadius: 6,
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: 12,
        cursor: 'pointer',
      },
    }

    /**
     * The settings section (T-2-f), as one component.
     *
     * It edits the key and reports only what the seam said about it: present or not, and which
     * layer answered. The literal is never read back -- none of the four calls below returns one,
     * and the field is cleared the moment a save is answered.
     *
     * Placed after useKeySection so the reading order matches the order things happen: state, the
     * three crossings, then the one place that shows them.
     */
    function MultiPoolSettings() {
      const key = useKeySection()
      const state = key.state
      const busy = state.busy !== null

      // Ask once on arrival: the section owes the reader its own answer before the reader clicks
      // anything, and read() is the one projection this page needs (where the key lives), not the
      // rail's three lines. No timer here -- save/forget re-ask after they land, and those are the
      // only two moments this page's own text can change.
      React.useEffect(function () {
        void key.read()
      }, [])

      const onChange = function (event) {
        key.setDraft(event.currentTarget.value)
      }

      const where = whereOf(state)

      return React.createElement(
        'div',
        {
          style: settingsStyles.root,
          'data-multipool-settings': 'true',
          'data-multipool-reading': state.reading,
        },
        React.createElement('div', { key: 'title', style: settingsStyles.title }, SETTINGS.title),
        React.createElement('div', { key: 'intro', style: settingsStyles.note }, SETTINGS.intro),
        React.createElement('label', { key: 'where', style: settingsStyles.where, 'data-multipool-where': 'true' }, where),
        React.createElement('input', {
          key: 'field',
          type: 'password',
          value: key.draft,
          placeholder: SETTINGS.placeholder,
          'aria-label': SETTINGS.title,
          autoComplete: 'off',
          spellCheck: false,
          disabled: busy,
          style: settingsStyles.field,
          onChange: onChange,
        }),
        React.createElement(
          'div',
          { key: 'actions', style: settingsStyles.actions },
          React.createElement(
            'button',
            { key: SAVE, type: 'button', disabled: busy || key.draft === '', onClick: key.save, style: settingsStyles.button },
            busy && state.busy === SAVE ? SETTINGS.saving : SETTINGS.save,
          ),
          React.createElement(
            'button',
            { key: FORGET, type: 'button', disabled: busy, onClick: key.forget, style: settingsStyles.button },
            busy && state.busy === FORGET ? SETTINGS.forgetting : SETTINGS.forget,
          ),
          React.createElement(
            'button',
            { key: 'test', type: 'button', disabled: busy, onClick: key.test, style: settingsStyles.button },
            busy && state.busy === 'test' ? SETTINGS.testing : SETTINGS.test,
          ),
        ),
        React.createElement(
          'div',
          { key: 'said', style: settingsStyles.note, 'data-multipool-said': 'true' },
          state.said === null || state.said === undefined ? '' : String(state.said),
        ),
        React.createElement('div', { key: 'care', style: settingsStyles.note }, SETTINGS.note),
      )
    }

    /**
     * The settings section's state and its three edge-crossings.
     *
     * Returns a plain object rather than living in a component body so a test can drive it without
     * React: every sentence this page shows has to be the same sentence the TypeScript copy shows,
     * and a sentence reachable only through a rendered tree is one no test can compare.
     */
    // The host's sentence for one upstream read, kept out of useKeySection so the factory can
    // hand it to the loader test: a wrong endpoint here is invisible to every other test -- every
    // one of them injects a fake host that agrees with whatever URL it is given.
    /**
     * Where the key lives, in one line, and only in the words the host supplied.
     *
     * Three states, and the third says the least on purpose: a key whose layer nobody reported is a
     * key that exists. Writing "survives the terminal" from that would be this page asserting
     * something about the store it was never told -- absence is not a licence to infer.
     */
    function whereOf(read) {
      if (read.reading === 'unread') return SETTINGS.unread
      if (read.present !== true) return SETTINGS.notStored
      const named = read.layer === undefined ? '' : layerWord(read.layer)
      // Nothing opened, nothing to close: an unknown layer name leaves the line as the bare sentence
      // rather than as a bracket holding this page's ignorance.
      if (named === '') return SETTINGS.stored
      return SETTINGS.stored + SETTINGS.inLayer + named
    }

    function useKeySection() {
      // The page never learns the key. describe() answers whether one is configured, and the
      // layer it came from; that is the whole vocabulary this section has for "is it there".
      const statePair = React.useState(function () {
        return { reading: 'unread', present: false, layer: undefined, busy: null, said: null }
      })
      const state = statePair[0]
      const setState = statePair[1]
      const draftPair = React.useState(function () {
        return ''
      })
      const draft = draftPair[0]
      const setDraft = draftPair[1]

      // Every answer the store gives is shown as it gave it: the writer in key-store.ts already
      // wraps its own refusals in the store's words, and re-wording them here would put a
      // second author between the user and the only sentence that knows why the write failed.
      const say = function (sentence, busy) {
        setState(function (was) {
          return { reading: was.reading, present: was.present, layer: was.layer, busy: busy, said: sentence }
        })
      }

      const read = function () {
        return viewOf().then(function (view) {
          const counts = view === undefined || view === null ? undefined : view.counts
          const word = counts === undefined ? undefined : counts.reading
          setState(function (was) {
            return {
              reading: word === undefined || word === 'unread' ? 'unread' : 'read',
              present: word === undefined || word === 'unread' ? false : counts.available > 0,
              // Taken from the same answer that carried the count, never remembered from a
              // previous one: a layer the reader saw once and kept would outlive a key they then
              // deleted, and print "stored in your environment" over an empty field.
              layer: view === undefined || view === null ? undefined : view.layer,
              busy: was.busy,
              said: was.said,
            }
          })
        })
      }

      const save = function () {
        say(null, SAVE)
        return commandOf({ name: 'save', key: draft }).then(function (outcome) {
          if (outcome.ok === true) {
            setDraft('')
            say(SETTINGS.stored, null)
            return read()
          }
          say(outcome.message === undefined || outcome.message === null ? outcome.reason : outcome.message, null)
          return undefined
        })
      }

      const forget = function () {
        say(null, FORGET)
        return commandOf({ name: 'forget' }).then(function (outcome) {
          if (outcome.ok === true) {
            say(SETTINGS.notStored, null)
            return read()
          }
          say(outcome.message === undefined || outcome.message === null ? outcome.reason : outcome.message, null)
          return undefined
        })
      }

      // The test button asks the host to do one upstream read, and prints whatever came back --
      // including the sentence for "I could not ask". It used to print the snapshot's three lines,
      // which are the icon's answer and not the upstream's: a button named "test connection" that
      // never made a connection was the quietest lie on this page.
      const test = function () {
        say(null, 'test')
        return ask(ENDPOINT_TEST).then(function (outcome) {
          return say(sentenceOf(outcome), null)
        })
      }

      return {
        state: state,
        draft: draft,
        setDraft: setDraft,
        save: save,
        forget: forget,
        test: test,
        read: read,
      }
    }

    /** The rail row: one dot, plus the fraction in words when the rail is wide enough to say it. */
    function SidebarIcon(props) {
      const pair = React.useState(emptyView)
      const view = pair[0]
      const setView = pair[1]

      // Kept current rather than fetched once: the host half owns the reading, and this row has no
      // way of knowing when it changed. follow() also guards the unmounted case, so a late answer
      // that arrives after the row is gone does not set state on a dead tree.
      React.useEffect(function () {
        return follow(setView)
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

      React.useEffect(function () {
        var live = true
        // One timer for the rail, one for the panel, both on the same interval: the badge and the
        // panel cannot disagree about the pool while both are on screen.
        var stopFollowing = follow(setView)
        return function () {
          live = false
          stopFollowing()
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
      // Same reason as commandOf, one layer down: viewOf() is where the host's answer turns into what
      // the rail paints, so a wrong turn there is invisible on a page that has no host yet.
      viewOf: viewOf,
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
        // The settings page is the third half of the same plugin, not a separate one: it lives
        // inside Settings' own list slot, and it cannot exist before Settings does. Every other
        // slot here is declared by a plugin this profile always loads; this one is declared by
        // client-ui-settings-general, inside a whenAccess for the host's settings/describe, so an
        // install that composed no settings shell has no such slot and this inject is a no-op.
        ctx.slots.inject('settings.section', () =>
          ctx.effect(() =>
            ctx.slots.register(
              {
                name: 'settings.section',
                id: 'dsh-multipool',
                order: 40,
                label: PANEL_LABEL,
              },
              MultiPoolSettings,
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
      commandOf: commandOf,
      viewOf: viewOf,
      testOf: testOf,
      sentenceOf: sentenceOf,
      whereOf: whereOf,
    }
  },
})
