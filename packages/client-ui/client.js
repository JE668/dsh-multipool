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
    // The dashboard's two halves -- an hour of minutes folded into a line, and the rows behind it --
    // come back from one call, because a curve drawn at 10:31:02 beside a table filled at 10:31:05
    // would be a comparison of two moments presented as one tick (T-3-b).
    var ENDPOINT_DASHBOARD = 'dashboard'
    var ENDPOINT_DIAGNOSE = 'diagnose'
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
      diagnose: '账号汇总诊断',
      diagnoseTesting: '正在诊断…',
      diagnoseTooSoon: '上一次诊断不到一分钟，这次不发（上游每账号一分钟只算一次）',
      // Two sentences for the two ways a test can end without a number. Neither is an error,
      // and neither is a zero: one says the button refused itself, the other says the upstream
      // answered with nothing this page may read.
      tooSoon: '\u4e0a\u4e00\u6b21\u8bf7\u6c42\u8fd8\u4e0d\u5230\u4e00\u5206\u949f\uff0c\u8fd9\u6b21\u6ca1\u53d1\uff08\u4e0a\u6e38\u9650\u4e00\u5206\u949f\u4e00\u6b21\uff09',
      reached: '\u4e0a\u6e38\u5df2\u56de\u7b54\uff0c\u4f46\u6ca1\u5e26\u56de\u7528\u91cf\u6570\u5b57',
      // "used", not "upstream answered:": what follows is a quantity, and a quote from the upstream
      // that happens to hold a quantity is not the same claim. The second word is the ceiling, and
      // it has to be visible as a ceiling, because a bare slash reads as a fraction -- 0.65 / 1 as
      // "65 percent through" is not what the upstream reported, and not what this page may imply.
      reading: '\u5df2\u7528',
      // Said only on a carried count: the number is real, the request behind it is not new.
      carried: '\uff08\u6cbf\u7528\u4e0d\u5230\u4e00\u5206\u949f\u524d\u7684\u90a3\u6b21\u8bfb\u53d6\uff09',
      // The third sentence, for "the host answered nothing at all" -- a dead route, not a dead key.
      unreachable: '\u6ca1\u6709\u6536\u5230\u4e0a\u6e38\u7684\u56de\u7b54',
      unread: '\u672c\u673a\u8fd8\u6ca1\u8bfb\u8fc7',
      stored: '\u5df2\u5b58\u5728\u672c\u673a',
      inLayer: '\uff08',
      notStored: '\u672c\u673a\u8fd8\u6ca1\u6709\u5b58',
      // layerWord answers a bare noun and SETTINGS.close closes whereOf()'s bracket, so the two
      // cannot get out of step: a word that brought its own bracket would print "stored (config
      // file)" next to a sentence that never opened one. If the seam cannot name a layer, layerWord
      // answers nothing and no bracket was opened -- whereOf() checks that, not this table.
      inFile: '\u914d\u7f6e\u6587\u4ef6',
      inEnv: '\u73af\u5883\u53d8\u91cf',
      inProjectEnv: '\u9879\u76ee\u73af\u5883\u53d8\u91cf',
      inUserEnv: '\u7528\u6237\u73af\u5883\u53d8\u91cf',
      close: '\uff09',
      note: '\u5e76\u53d1 8 \u4e0e RPM 20 \u6765\u81ea docs/02 section 1.1 \u4e0e section 1.4\uff0c\u4ee5\u4e0a\u6e38\u56de\u6267\u4e3a\u51c6\u3002\u4f59\u989d\u53ea\u80fd\u4ece GET /v1/usage \u8bfb\uff0c\u4e0d\u5728\u8fd9\u4e00\u9875\u7b97\u3002',
      // Step 2 gate toggle: the settings section flips this, and the intercept layer reads it
      // on every AMD request. Absent means off -- read-only, nothing refused, nothing delayed.
      rejectLabel: '\u62a5\u589e\u6536\u957f\u7684\u8bf7\u6c42',
      rejectOff: '\u8df3\u8fc7\u4e0d\u8d85\u989d\u7684\u8bf7\u6c42\uff08\u53ea\u8bb0\u8f93\u7387\u901a\u3002\uff09',
      rejectOn: '\u62a5\u589e\u6536\u957f\u7684\u8bf7\u6c42\uff08\u8d85\u989d\u65f6\u76f4\u63a5\u56de 429\u3002\uff09',
      // Immersion toggle: opens the panel as a shell overlay instead of only inside the drawer.
      // Default off: nothing mounts anywhere the reader has not asked for.
      dashboardLabel: '\u6c60\u6f0f\u770b\u677f',
      dashboardOff: '\u6c60\u6f0f\u770b\u677f\uff08\u9ed8\u8ba4\u4e0d\u63a2\u8f6c\uff0c\u53ea\u5728\u628f\u5f15\u7bb1\u91cc\u770b\uff09',
      dashboardOn: '\u6c60\u6f0f\u770b\u677f\uff08\u5df2\u63a2\u8f6c\u70b9\uff09',
      // T-8-e: Google settings group. No account-RPM input (Google has no usage endpoint),
      // just prefix hint + PT timezone display + collapsed default.
      googleLabel: '\u767E\u5229 (Google)',
      googleIntro: '\u4f7f\u7528 OpenAI \u529f\u80fd\u754c\u9762\u6240\u6709\u7684\u6a21\u578b\u90fd\u662f Google \u5361\u724c\u3002\u5b8c\u6574\u529f\u80fd\u89c4\u5219\u9700\u8981\u8bb0\u8f93 /v1/usage \u65e5\u5206\u91cf\uff0c\u4f46 Google \u672a\u5f97\u624d\u8fbe\u53ea\u662f\u6240\u6709\u6a21\u578b\u53d6\u503c\u3002',
      googlePrefixHint: 'API Key \u987a\u7f00\u4e3a AIza\u3002',
      googleTimezone: '\u65e5\u5206 \u8fde\u6566 \u65f6\u5c40: Pacific Time (America/Los_Angeles)\uff0c\u6bcf\u591d 00:00 PT\u91cd\u7b2c\u3002',
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
      // A carried answer is spoken in this page's words, and it is spoken first. `said` on a
      // carried answer is the host's fall-through sentence -- written for a reader of logs, in
      // English -- and quoting it here is how one button came to answer in two languages,
      // depending only on which second the upstream happened to reply in. The number is real
      // either way; the sentence is the page's, and the host reports.
      var carried = attempt.carried === true
      // A reading that came back with no number is still a reading: calling it the host's
      // failure would blame the host for answering.
      var usage = attempt.usage
      var countable = usage !== undefined && usage !== null
      if (!carried && !countable) return SETTINGS.reached
      if (!carried && typeof attempt.said === 'string' && attempt.said !== '') return attempt.said
      var carrier = carried ? SETTINGS.carried : ''
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

    /** The hour the host folded, or nothing at all -- never a zero drawn in its place. */
    function dashboardOf() {
      return ask(ENDPOINT_DASHBOARD, {}).then(
        function (answer) {
          // No host, no answer, no story: null is what the panel prints a sentence for.
          if (answer === undefined || answer === null) return null
          if (answer.trend === undefined || answer.rows === undefined) return null
          return answer
        },
        function () {
          return null
        },
      )
    }

    /**
     * The hour, folded here from the reading the host folded there.
     *
     * client.js cannot require the rest of the package -- the page's module table has one seed word
     * -- so the drawer inline the parts that decide what gets painted, and painters that reach
     * parity.test.ts keep the two copies saying one thing. Same door as ptsOf above: the host
     * sends minutes, the drawer sends strokes, and a test can hold both ends without a host running.
     */
    function hourOf(hourItem) {
      if (hourItem === undefined || hourItem === null) return null
      var trend = hourItem.trend
      if (trend === undefined || trend === null) return null
      var measured = 0
      for (var index = 0; index < trend.length; index += 1) {
        var point = trend[index]
        if (point !== undefined && point !== null && point.rate !== null && point.rate !== undefined) {
          measured += 1
        }
      }
      return {
        trend: trend,
        measured: measured,
        concurrency: hourItem.concurrency === undefined ? [] : hourItem.concurrency,
        heat: hourItem.heat === undefined ? [] : hourItem.heat,
      }
    }

    var COMMAND_FAILED = 'command failed'

    /*
     * The drawing rules of core/dashboard.ts, copied.
     *
     * Same reason ptsOf and hourOf are copied: the page's module table has one seed word, so this
     * file cannot require the rest of the package. Each copy is held to its original by
     * parity.test.ts; a copy that drifts is a copy that test calls wrong.
     *
     * The constants are literals here and named there because this file's copy is read by the
     * browser, not by a compiler -- the parity table compares behaviour, and PLOT_WIDTH is only a
     * convenience for whoever reads the geometry below.
     */
    var PLOT_WIDTH = 320
    var PLOT_HEIGHT = 96
    var PLOT_PAD_X = 6
    var PLOT_PAD_Y = 12

    function plotUnits(value) {
      return value.toFixed(1)
    }

    /**
     * The hour cut where nothing was measured.
     *
     * Returns one point-string per unbroken run. A minute whose rate is null starts nothing: joining
     * it to its neighbours would draw the pool at zero percent at the one moment it is wrong to draw
     * it at anything at all (docs/07 U-08).
     */
    function plotRunsOf(trend) {
      var plotWidth = PLOT_WIDTH - PLOT_PAD_X * 2
      var plotHeight = PLOT_HEIGHT - PLOT_PAD_Y * 2
      var span = Math.max(1, trend.length - 1)
      var runs = []
      var current = []
      for (var index = 0; index < trend.length; index += 1) {
        var point = trend[index]
        var rate = point === undefined ? null : point.rate
        if (rate === null || rate === undefined) {
          if (current.length > 0) runs.push(current)
          current = []
          continue
        }
        var share = Number(rate.value)
        var safe = isFinite(share) ? Math.min(100, Math.max(0, share)) : 0
        current.push(
          plotUnits(PLOT_PAD_X + (index / span) * plotWidth) +
            ',' +
            plotUnits(PLOT_PAD_Y + (1 - safe / 100) * plotHeight),
        )
      }
      if (current.length > 0) runs.push(current)
      return runs.map(function (run) {
        return run.join(' ')
      })
    }

    /**
     * The same hour's per-minute request count -- that is what "RPM" means here: the number of
     * upstream requests this plugin saw land in each drawn minute. A minute with no measurement
     * breaks the run just like the 429 share above: a gap is honest, a line across it is a floor
     * this page never measured (docs/07 U-08).
     */
    function plotRpmRunsOf(trend) {
      var plotWidth = PLOT_WIDTH - PLOT_PAD_X * 2
      var plotHeight = PLOT_HEIGHT - PLOT_PAD_Y * 2
      var span = Math.max(1, trend.length - 1)
      var maxRequests = 0
      for (var index = 0; index < trend.length; index += 1) {
        var point = trend[index]
        if (
          point !== undefined &&
          point !== null &&
          point.rate !== null &&
          point.rate !== undefined &&
          typeof point.requests === 'number' &&
          isFinite(point.requests) &&
          point.requests > maxRequests
        ) {
          maxRequests = point.requests
        }
      }
      var scale = maxRequests === 0 ? 0 : plotHeight / maxRequests
      var runs = []
      var current = []
      for (var index = 0; index < trend.length; index += 1) {
        var point = trend[index]
        var rate = point === undefined ? null : point.rate
        if (rate === null || rate === undefined) {
          if (current.length > 0) runs.push(current)
          current = []
          continue
        }
        var requests =
          point.requests === undefined || point.requests === null || !isFinite(point.requests)
            ? 0
            : point.requests
        current.push(
          plotUnits(PLOT_PAD_X + (index / span) * plotWidth) +
            ',' +
            plotUnits(
              PLOT_PAD_Y + (scale === 0 ? plotHeight : plotHeight - requests * scale),
            ),
        )
      }
      if (current.length > 0) runs.push(current)
      return runs.map(function (run) {
        return run.join(' ')
      })
    }

    /**
     * The same hour's worst concurrency seen at send time. A minute whose every request carried no
     * concurrency figure is a hole: drawing across it would claim zero concurrency at a moment we
     * never measured (docs/07 U-08).
     */
    function plotConcurrencyRunsOf(concurrency) {
      var plotWidth = PLOT_WIDTH - PLOT_PAD_X * 2
      var plotHeight = PLOT_HEIGHT - PLOT_PAD_Y * 2
      var span = Math.max(1, concurrency.length - 1)
      var maxConcurrency = 0
      for (var index = 0; index < concurrency.length; index += 1) {
        var point = concurrency[index]
        if (
          point !== undefined &&
          point !== null &&
          typeof point.maxConcurrency === 'number' &&
          isFinite(point.maxConcurrency) &&
          point.maxConcurrency > maxConcurrency
        ) {
          maxConcurrency = point.maxConcurrency
        }
      }
      var scale = maxConcurrency === 0 ? 0 : plotHeight / maxConcurrency
      var runs = []
      var current = []
      for (var index = 0; index < concurrency.length; index += 1) {
        var point = concurrency[index]
        if (
          point === undefined ||
          point === null ||
          typeof point.maxConcurrency !== 'number' ||
          !isFinite(point.maxConcurrency)
        ) {
          if (current.length > 0) runs.push(current)
          current = []
          continue
        }
        current.push(
          plotUnits(PLOT_PAD_X + (index / span) * plotWidth) +
            ',' +
            plotUnits(PLOT_PAD_Y + (scale === 0 ? plotHeight : plotHeight - point.maxConcurrency * scale)),
        )
      }
      if (current.length > 0) runs.push(current)
      return runs.map(function (run) {
        return run.join(' ')
      })
    }

    /**
     * Queue-wait heat: one polyline per logarithmic bucket (0-1s / 1-5s / 5-30s / 30s+), each minute
     * stacked as its count in that bucket. A minute with no measurement at all breaks every run,
     * because the page did not see anything there (docs/07 U-08).
     */
    function plotHeatRunsOf(heat) {
      var plotWidth = PLOT_WIDTH - PLOT_PAD_X * 2
      var plotHeight = PLOT_HEIGHT - PLOT_PAD_Y * 2
      var span = Math.max(1, heat.length - 1)
      var buckets = ['0-1s', '1-5s', '5-30s', '30s+']
      var maxCount = 0
      for (var index = 0; index < heat.length; index += 1) {
        var minute = heat[index]
        if (minute === undefined || minute === null) continue
        for (var b = 0; b < buckets.length; b += 1) {
          var count = minute.buckets[buckets[b]]
          if (typeof count === 'number' && isFinite(count) && count > maxCount) maxCount = count
        }
      }
      var scale = maxCount === 0 ? 0 : plotHeight / maxCount
      var seen = []
      for (var index = 0; index < heat.length; index += 1) {
        var minute = heat[index]
        seen[index] =
          minute !== undefined &&
          minute !== null &&
          buckets.some(function (b) {
            var count = minute.buckets[b]
            return typeof count === 'number' && isFinite(count) && count > 0
          })
      }
      var runs = []
      for (var b = 0; b < buckets.length; b += 1) {
        var current = []
        for (var index = 0; index < heat.length; index += 1) {
          if (!seen[index]) {
            if (current.length > 0) runs.push(current)
            current = []
            continue
          }
          var minute = heat[index]
          var count = minute.buckets[buckets[b]]
          current.push(
            plotUnits(PLOT_PAD_X + (index / span) * plotWidth) +
              ',' +
              plotUnits(PLOT_PAD_Y + (scale === 0 ? plotHeight : plotHeight - count * scale)),
          )
        }
        if (current.length > 0) runs.push(current)
        current = []
      }
      return runs.map(function (run) {
        return run.join(' ')
      })
    }

    /**
     * Provider x Model flow for the rows the table holds -- newest-first, this-session-only rows,
     * so it answers "since this process started, which models did requests flow to". No cost
     * figures anywhere (docs/06 T-3-d).
     */
    function sankeyLinks(rows) {
      var map = {}
      var order = []
      for (var index = 0; index < rows.length; index += 1) {
        var row = rows[index]
        var key = (row.providerId === undefined ? '—' : row.providerId) + '\u0000' + row.modelId
        if (map[key] === undefined) {
          map[key] = 0
          order.push(key)
        }
        map[key] += 1
      }
      var links = order.map(function (key) {
        var parts = key.split('\u0000')
        return { provider: parts[0], model: parts[1], count: map[key] }
      })
      links.sort(function (left, right) {
        return right.count - left.count
      })
      if (links.length > 6) {
        var kept = links.slice(0, 6)
        var other = 0
        for (var index = 6; index < links.length; index += 1) other += links[index].count
        kept.push({ provider: '—', model: '\u5176\u4ed6', count: other })
        links = kept
      }
      return links
    }

    function plotNoteOf(answered, measured) {
      if (!answered) return '\u5c1a\u672a\u542c\u5230\u5bbf\u4e3b'
      if (measured === 0) return '\u8fd8\u6ca1\u6709\u4efb\u4f55\u8bb0\u5f55'
      return '\u8fd9\u4e00\u5c0f\u65f6\u91cc\u6709 ' + String(measured) + ' \u5206\u949f\u5728\u8d70\u8bf7\u6c42'
    }

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

    function follow(keep, keepHour) {
      var live = true
      var tick = function () {
        if (!live) return
        viewOf().then(function (next) {
          if (live) keep(next)
        })
        // Same tick, second reader: the hour and the pool are asked together so the two halves of
        // the state panel cannot be rehearsing different minutes while claiming to be one screen.
        dashboardOf().then(function (hour) {
          if (live) keepHour(hour)
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
      toggle: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 12,
        color: 'var(--dsw-alias-label-primary)',
        cursor: 'pointer',
        userSelect: 'none',
      },
      toggleBox: {
        width: 20,
        height: 12,
        borderRadius: 6,
        border: '1px solid var(--dsw-alias-border-secondary)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 2,
        boxSizing: 'border-box',
      },
      toggleKnob: {
        width: 8,
        height: 8,
        borderRadius: 4,
        background: 'var(--dsw-alias-label-primary)',
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
      const rejectOn = key.rejectOnBudgetExhausted === true
      const dashboardOn = key.dashboardMode === true
      const diagnoseReady = state.diagnose.atMs === null || Date.now() - state.diagnose.atMs >= 60000

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
          React.createElement(
            'button',
            {
              key: 'diagnose',
              type: 'button',
              disabled: busy || state.diagnose.busy === 'diagnose' || !diagnoseReady,
              onClick: key.diagnose,
              style: settingsStyles.button,
            },
            busy && state.busy === 'diagnose' ? SETTINGS.diagnoseTesting : SETTINGS.diagnose,
          ),
        ),
        React.createElement(
          'div',
          { key: 'toggle', style: settingsStyles.toggle },
          React.createElement('span', null, SETTINGS.rejectLabel),
          React.createElement(
            'button',
            {
              key: 'toggle-button',
              type: 'button',
              disabled: busy,
              onClick: function () { void key.setRejectOnBudgetExhausted(!rejectOn) },
              style: {
                ...settingsStyles.toggleBox,
                background: rejectOn ? 'var(--dsw-alias-bg-success)' : 'var(--dsw-alias-bg-base)',
              },
            },
            React.createElement('div', {
              style: {
                ...settingsStyles.toggleKnob,
                marginLeft: rejectOn ? 10 : 2,
              },
            }),
          ),
          React.createElement('span', null, rejectOn ? SETTINGS.rejectOn : SETTINGS.rejectOff),
        ),
        React.createElement(
          'div',
          { key: 'toggle2', style: settingsStyles.toggle },
          React.createElement('span', null, SETTINGS.dashboardLabel),
          React.createElement(
            'button',
            {
              key: 'toggle-button',
              type: 'button',
              disabled: busy,
              onClick: function () { void key.setDashboardMode(!dashboardOn) },
              style: {
                ...settingsStyles.toggleBox,
                background: dashboardOn ? 'var(--dsw-alias-bg-success)' : 'var(--dsw-alias-bg-base)',
              },
            },
            React.createElement('div', {
              style: {
                ...settingsStyles.toggleKnob,
                marginLeft: dashboardOn ? 10 : 2,
              },
            }),
          ),
          React.createElement('span', null, dashboardOn ? SETTINGS.dashboardOn : SETTINGS.dashboardOff),
        ),
        React.createElement(
          'div',
          { key: 'said', style: settingsStyles.note, 'data-multipool-said': 'true' },
          state.said === null || state.said === undefined ? '' : String(state.said),
        ),
        React.createElement(
          'div',
          { key: 'diagnose', style: settingsStyles.note, 'data-multipool-diagnose': 'true' },
          state.diagnose.said === null ? '' : String(state.diagnose.said) + '，上游限额 ' + (state.diagnose.limit === null ? '\u2014' : String(state.diagnose.limit)) + ' / 剩余 ' + (state.diagnose.remaining === null ? '\u2014' : String(state.diagnose.remaining)) + '；本地假设 Key \u00d7 30 = 30',
        ),
        React.createElement(
          'div',
          { key: 'dashboard', style: settingsStyles.note, 'data-multipool-dashboard': 'true' },
          dashboardOn ? SETTINGS.dashboardOn : SETTINGS.dashboardOff,
        ),
        React.createElement('div', { key: 'care', style: settingsStyles.note }, SETTINGS.note),
      )
    }

    /**
     * T-8-e: Google settings group. Fifth slot, collapsed by default. No key input field --
     * Google keys carry their own prefix hint (AIza...) and there is no usage endpoint, so
     * nothing to save and nothing to read. Just prefix hint + PT timezone display.
     */
    function GoogleSettings() {
      return React.createElement(
        'div',
        { style: settingsStyles.root },
        React.createElement('div', { key: 'title', style: settingsStyles.title }, SETTINGS.googleLabel),
        React.createElement('div', { key: 'intro', style: settingsStyles.note }, SETTINGS.googleIntro),
        React.createElement('div', { key: 'prefix', style: settingsStyles.note }, SETTINGS.googlePrefixHint),
        React.createElement('div', { key: 'timezone', style: settingsStyles.note }, SETTINGS.googleTimezone),
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
      return SETTINGS.stored + SETTINGS.inLayer + named + SETTINGS.close
    }

    function useKeySection() {
      // The page never learns the key. describe() answers whether one is configured, and the
      // layer it came from; that is the whole vocabulary this section has for "is it there".
      const statePair = React.useState(function () {
        return { reading: 'unread', present: false, layer: undefined, busy: null, said: null, diagnose: { busy: null, said: null, limit: null, remaining: null, atMs: null } }
      })
      const state = statePair[0]
      const setState = statePair[1]
      const draftPair = React.useState(function () {
        return ''
      })
      const draft = draftPair[0]
      const setDraft = draftPair[1]
      const rejectPair = React.useState(function () {
        return false
      })
      const rejectOnBudgetExhausted = rejectPair[0]
      const setRejectOnBudgetExhausted = rejectPair[1]
      const dashboardPair = React.useState(function () {
        return false
      })
      const dashboardMode = dashboardPair[0]
      const setDashboardMode = dashboardPair[1]

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

      const diagnose = function () {
        const now = Date.now()
        var lastAt = null
        if (state.diagnose !== null && state.diagnose !== undefined) lastAt = state.diagnose.atMs
        if (lastAt !== null && now - lastAt < 60000) {
          say(SETTINGS.diagnoseTooSoon, null)
          return undefined
        }
        setState(function (was) {
          return { reading: was.reading, present: was.present, layer: was.layer, busy: 'diagnose', said: was.said, diagnose: was.diagnose }
        })
        return ask(ENDPOINT_DIAGNOSE).then(function (outcome) {
          var sentence = null
          var limit = null
          var remaining = null
          if (outcome === undefined || outcome === null || outcome.ok !== true) {
            sentence = outcome === null || outcome === undefined ? SETTINGS.unreachable : (outcome.message || outcome.reason || SETTINGS.unreachable)
          } else {
            sentence = outcome.said
            limit = outcome.upstreamLimit
            remaining = outcome.upstreamRemaining
          }
          setState(function (was) {
            return {
              reading: was.reading,
              present: was.present,
              layer: was.layer,
              busy: null,
              said: was.said,
              diagnose: { busy: null, said: sentence, limit: limit, remaining: remaining, atMs: now },
            }
          })
          return outcome
        })
      }

      const saveReject = function (value) {
        setRejectOnBudgetExhausted(value)
        return commandOf({ name: 'reject-on-budget-exhausted', value: value }).then(function (outcome) {
          if (outcome.ok !== true) {
            // Revert on refusal: the host said no, so the local state must not claim yes.
            setRejectOnBudgetExhausted(!value)
            say(outcome.message === undefined || outcome.message === null ? outcome.reason : outcome.message, null)
          }
          return outcome
        })
      }

      const saveDashboard = function (value) {
        setDashboardMode(value)
        return commandOf({ name: 'dashboard-mode', value: value }).then(function (outcome) {
          if (outcome.ok !== true) {
            setDashboardMode(!value)
            say(outcome.message === undefined || outcome.message === null ? outcome.reason : outcome.message, null)
          }
          return outcome
        })
      }

      return {
        state: state,
        draft: draft,
        setDraft: setDraft,
        save: save,
        forget: forget,
        test: test,
        diagnose: diagnose,
        read: read,
        rejectOnBudgetExhausted: rejectOnBudgetExhausted,
        setRejectOnBudgetExhausted: saveReject,
        dashboardMode: dashboardMode,
        setDashboardMode: saveDashboard,
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

    var COLUMNS = [
      '\u65f6\u523b',
      '\u6a21\u578b',
      '\u72b6\u6001',
      '\u9650\u6d41',
      '\u8017\u65f6 ms',
      '\u8f93\u5165 token',
      '\u8f93\u51fa token',
      '\u7b2c\u51e0\u6b21',
      '\u6392\u961f ms',
    ]

    /**
     * The line above the table, and the two facts it exists to state.
     *
     * "Only this session" is not a filter this page chose to be tidy -- rows are folded from the
     * host's own counters, and those begin when this process does (docs/06 T-3-b, the second half
     * of the question asked there). Saying it once, above the table, is cheaper than a reader
     * concluding from a short list that the pool was quiet all month.
     */
    var TABLE_NOTE = '\u672c\u6b21\u542f\u52a8\u4ee5\u540e\uff1b\u66f4\u65e9\u7684\u4e0d\u5728\u8fd9\u91cc\u3002'
    var TABLE_EMPTY = '\u8fd8\u6ca1\u6709\u8bb0\u5f55\u5230\u8bf7\u6c42\u3002'

    /**
     * The minute, as a person reads a clock.
     *
     * Fixed to Shanghai like the pts label on line three, and for the same reason docs/05 gives
     * there: the upstream's day rolls over on Beijing midnight, so a curve printed in the machine's
     * local zone would put the daily reset in the middle of its own hour. Only the clock of a single
     * minute is drawn -- the day is already on the label beside it.
     */
    /**
     * Two digits, from a number that is already one or two.
     *
     * It lives here rather than in core because it is punctuation for a clock face, not
     * arithmetic: nine o'clock is "09:05" to a reader, and "9:5" is a typo wearing a
     * timestamp's clothes.
     */
    function pad2(value) {
      return value < 10 ? '0' + String(value) : String(value)
    }

    function clockOf(atMs) {
      if (typeof atMs !== 'number' || !isFinite(atMs)) return String(atMs)
      var minutes = Math.floor(atMs / 60000)
      var ofDay = ((minutes % 1440) + 1440) % 1440
      return pad2(Math.floor(ofDay / 60)) + ':' + pad2(ofDay % 60)
    }

    function hourLabelOf(atMs) {
      if (typeof atMs !== 'number' || !isFinite(atMs)) return String(atMs)
      var minutes = Math.floor(atMs / 60000)
      var ofDay = ((minutes % 1440) + 1440) % 1440
      return pad2(Math.floor(ofDay / 60)) + ':' + pad2(ofDay % 60)
    }

    /**
     * One cell of the table, as text.
     *
     * Null and undefined both become the em dash, and neither becomes "0" or "0ms": a cell that says
     * the event carried no such figure is a different claim from a cell that says the figure was
     * zero, and the table is the one place in the panel where every column has to make that
     * distinction on every row (docs/07 U-06).
     */
    function cellOf(value) {
      if (value === null || value === undefined) return NO_VALUE
      if (typeof value === 'number' && !isFinite(value)) return NO_VALUE
      return String(value)
    }

    /**
     * A row as the table prints it: the clock, then the facts, then the counts that may be absent.
     *
     * The status does not go through cellOf with the same shrug the rest do -- an event with no
     * status is not a request we know little about, it is verbatim something that should never have
     * been recorded, and a dash in that column would hide it from the one reader looking for it.
     */
    function cellsOf(row) {
      return [
        clockOf(row.atMs),
        cellOf(row.modelId),
        cellOf(row.status),
        cellOf(row.rateKind),
        cellOf(row.latencyMs),
        cellOf(row.promptTokens),
        cellOf(row.completionTokens),
        cellOf(row.attempt),
        cellOf(row.queueWaitMs),
      ]
    }

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

      // null is the panel's fourth state, and the only one it may paint as words: no host answered
      // yet, which is not an hour in which nothing happened (docs/07 U-08).
      const hourPair = React.useState(function () { return null })
      const hour = hourPair[0]
      const setHour = hourPair[1]

      React.useEffect(function () {
        // One timer for the rail, one for the panel, both on the same interval: the badge and the
        // panel cannot disagree about the pool while both are on screen.
        return follow(setView, setHour)
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
          lineHeight: '18px',
          whiteSpace: 'pre-wrap',
        },
        table: {
          borderCollapse: 'collapse',
          fontFamily: 'var(--dsw-font-mono)',
          fontSize: 11,
          lineHeight: '16px',
          fontVariantNumeric: 'tabular-nums',
        },
        head: {
          textAlign: 'left',
          fontWeight: 600,
          color: 'var(--dsw-alias-label-tertiary)',
          padding: '0 8px 0 0',
          borderBottom: '1px solid var(--dsw-alias-border-secondary)',
        },
        cell: {
          textAlign: 'left',
          color: 'var(--dsw-alias-label-secondary)',
          padding: '2px 8px 2px 0',
          whiteSpace: 'nowrap',
        },
      }

      const rows = [
        React.createElement('div', { key: 'accounts', style: styles.line, 'data-multipool-line': 'accounts' }, view.lines.accounts),
        React.createElement('div', { key: 'rpm', style: styles.line, 'data-multipool-line': 'rpm' }, view.lines.rpm),
        React.createElement('div', { key: 'points', style: styles.line, 'data-multipool-line': 'points' }, view.lines.points),
      ]

      // The hour, drawn from whatever the host last folded. dashboardOf() hands back the payload
      // itself, so the shape the panel reads here is the shape the host sent -- not a guess made in
      // the drawer about a wire that has not been built yet.
      //
      // The y axis carries the 429 share, so 0 sits at the bottom and the tallest point is 100.
      // Drawn as one polyline per unbroken run: a minute with no requests ends a run, and a line
      // through that break is the invented floor this whole task is about (docs/07 U-08).
      const folded = hourOf(hour)
      // An hour with minutes but no rate in it is not a figure -- it is the same blank box as no hour
      // at all, and it gets the same sentence, because the drawer has measured nothing either way.
      const runs = folded === null ? [] : plotRunsOf(folded.trend)
      const rpmRuns = folded === null ? [] : plotRpmRunsOf(folded.trend)
      const stroke = levelColor(view.level)
      const curve = runs.length === 0
        ? React.createElement(
            'div',
            { key: 'curve', style: styles.note, 'data-multipool-curve': 'none' },
            plotNoteOf(hour !== null, folded === null ? 0 : folded.measured),
          )
        : React.createElement(
            'svg',
            {
              key: 'curve',
              viewBox: '0 0 ' + String(PLOT_WIDTH) + ' ' + String(PLOT_HEIGHT),
              width: '100%',
              height: String(PLOT_HEIGHT),
              style: { display: 'block', overflow: 'visible' },
              'data-multipool-curve': 'line',
            },
            runs.map(function (points, index) {
              return React.createElement('polyline', {
                key: 'run-' + String(index),
                points: points,
                fill: 'none',
                stroke: stroke,
                strokeWidth: 1.5,
                strokeLinejoin: 'round',
                strokeLinecap: 'round',
              })
            }),
          )
      const rpmCurve = rpmRuns.length === 0
        ? React.createElement(
            'div',
            { key: 'rpm-curve', style: styles.note, 'data-multipool-curve': 'rpm-none' },
            plotNoteOf(hour !== null, folded === null ? 0 : folded.measured),
          )
        : React.createElement(
            'svg',
            {
              key: 'rpm-curve',
              viewBox: '0 0 ' + String(PLOT_WIDTH) + ' ' + String(PLOT_HEIGHT),
              width: '100%',
              height: String(PLOT_HEIGHT),
              style: { display: 'block', overflow: 'visible' },
              'data-multipool-curve': 'rpm',
            },
            rpmRuns.map(function (points, index) {
              return React.createElement('polyline', {
                key: 'rpm-run-' + String(index),
                points: points,
                fill: 'none',
                stroke: stroke,
                strokeWidth: 1.5,
                strokeLinejoin: 'round',
                strokeLinecap: 'round',
              })
            }),
          )
      const concRuns = folded === null ? [] : plotConcurrencyRunsOf(folded.concurrency)
      const concCurve = concRuns.length === 0
        ? React.createElement(
            'div',
            { key: 'conc-curve', style: styles.note, 'data-multipool-curve': 'conc-none' },
            plotNoteOf(hour !== null, folded === null ? 0 : folded.measured),
          )
        : React.createElement(
            'svg',
            {
              key: 'conc-curve',
              viewBox: '0 0 ' + String(PLOT_WIDTH) + ' ' + String(PLOT_HEIGHT),
              width: '100%',
              height: String(PLOT_HEIGHT),
              style: { display: 'block', overflow: 'visible' },
              'data-multipool-curve': 'concurrency',
            },
            concRuns.map(function (points, index) {
              return React.createElement('polyline', {
                key: 'conc-run-' + String(index),
                points: points,
                fill: 'none',
                stroke: stroke,
                strokeWidth: 1.5,
                strokeLinejoin: 'round',
                strokeLinecap: 'round',
              })
            }),
          )
      const heatRuns = folded === null ? [] : plotHeatRunsOf(folded.heat)
      const heatChart = heatRuns.length === 0
        ? React.createElement(
            'div',
            { key: 'heat-curve', style: styles.note, 'data-multipool-curve': 'heat-none' },
            plotNoteOf(hour !== null, folded === null ? 0 : folded.measured),
          )
        : React.createElement(
            'svg',
            {
              key: 'heat-curve',
              viewBox: '0 0 ' + String(PLOT_WIDTH) + ' ' + String(PLOT_HEIGHT),
              width: '100%',
              height: String(PLOT_HEIGHT),
              style: { display: 'block', overflow: 'visible' },
              'data-multipool-curve': 'heat',
            },
            heatRuns.map(function (points, index) {
              return React.createElement('polyline', {
                key: 'heat-run-' + String(index),
                points: points,
                fill: 'none',
                stroke: stroke,
                strokeWidth: 1.5,
                strokeLinejoin: 'round',
                strokeLinecap: 'round',
              })
            }),
          )

      var sankeyFlow = folded === null ? [] : sankeyLinks(hour.rows)
      var maxSankey = 0
      for (var index = 0; index < sankeyFlow.length; index += 1) {
        if (sankeyFlow[index].count > maxSankey) maxSankey = sankeyFlow[index].count
      }
      var sankey = sankeyFlow.length === 0
        ? React.createElement(
            'div',
            { key: 'sankey', style: styles.note, 'data-multipool-sankey': 'none' },
            plotNoteOf(hour !== null, folded === null ? 0 : folded.measured),
          )
        : (function () {
            var providerX = 44
            var providerY = 48
            var modelX = 320 - 26
            var count = sankeyFlow.length
            var items = []
            for (var index = 0; index < count; index += 1) {
              var link = sankeyFlow[index]
              var modelY = count === 1 ? providerY : PLOT_PAD_Y + (index / (count - 1)) * (PLOT_HEIGHT - PLOT_PAD_Y * 2)
              var width = Math.max(1, Math.min(8, 1 + (link.count / maxSankey) * 7))
              var mx = modelX - 10
              var px = providerX + 10
              items.push(
                React.createElement('path', {
                  key: 'sankey-' + String(index),
                  d:
                    'M ' +
                    plotUnits(px) +
                    ' ' +
                    plotUnits(providerY) +
                    ' Q ' +
                    plotUnits((px + mx) / 2) +
                    ' ' +
                    plotUnits((providerY + modelY) / 2) +
                    ' ' +
                    plotUnits(mx) +
                    ' ' +
                    plotUnits(modelY),
                  stroke: stroke,
                  strokeWidth: width,
                  strokeOpacity: 0.6,
                  fill: 'none',
                }),
              )
              items.push(
                React.createElement(
                  'text',
                  {
                    key: 'sankey-label-' + String(index),
                    x: 316,
                    y: plotUnits(modelY + 3),
                    style: { fontSize: 8, fill: 'var(--dsw-alias-label-tertiary)', textAnchor: 'end' },
                  },
                  link.model,
                ),
              )
            }
            items.push(
              React.createElement(
                'text',
                {
                  key: 'sankey-provider',
                  x: 30,
                  y: plotUnits(providerY + 3),
                  style: { fontSize: 8, fill: 'var(--dsw-alias-label-tertiary)' },
                },
                sankeyFlow[0].provider,
              ),
            )
            return React.createElement(
              'svg',
              {
                key: 'sankey',
                viewBox: '0 0 ' + String(PLOT_WIDTH) + ' ' + String(PLOT_HEIGHT),
                width: '100%',
                height: String(PLOT_HEIGHT),
                style: { display: 'block', overflow: 'visible' },
                'data-multipool-sankey': 'flow',
              },
              items,
            )
          })()

      // The rows, newest first, exactly as rowsOf() ordered them -- the drawer does not sort, because
      // a sort here would be a second opinion about what "unknown" means and the two opinions would
      // eventually disagree (docs/07 U-07).
      const table = hour === null || hour.rows.length === 0
        ? React.createElement('div', { key: 'table', style: styles.note, 'data-multipool-table': 'empty' },
            TABLE_EMPTY)
        : React.createElement(
            'table',
            {
              key: 'table',
              style: styles.table,
              'data-multipool-table': 'rows',
            },
            React.createElement('thead', { key: 'head' },
              React.createElement('tr', { key: 'head-row' },
                COLUMNS.map(function (name) {
                  return React.createElement('th', { key: name, style: styles.head }, name)
                }),
              ),
            ),
            React.createElement('tbody', { key: 'body' },
              hour.rows.map(function (row) {
                return React.createElement('tr', { key: row.requestId },
                  cellsOf(row).map(function (cell, index) {
                    return React.createElement('td', { key: COLUMNS[index], style: styles.cell }, cell)
                  }),
                )
              }),
            ),
          )

      const children = [
        React.createElement('div', { key: 'title', style: styles.title },
          'AMD \u8d26\u53f7\u6c60'),
        React.createElement('div', { key: 'rows' }, rows),
        curve,
        rpmCurve,
        concCurve,
        heatChart,
        sankey,
        React.createElement('div', { key: 'table-note', style: styles.note, 'data-multipool-table-note': 'true' },
          TABLE_NOTE),
        table,
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
        // The settings page lives inside Settings' own list slot. Register directly (not via
        // ctx.slots.inject) so the entry is present when the settings shell reads
        // entries('settings.section') synchronously on page open. Deferred inject callbacks fire
        // after the shell has already snapshot the slot list, leaving the page blank.
        ctx.slots.register(
          {
            name: 'settings.section',
            id: 'dsh-multipool',
            order: 40,
            label: () => PANEL_LABEL,
            locale: 'dsh-multipool',
          },
          MultiPoolSettings,
        )
        // T-8-e: Google settings group, fifth slot (order 50). Nothing to save, nothing to read --
        // just prefix hint and PT timezone display.
        ctx.slots.register(
          {
            name: 'settings.section',
            id: 'dsh-multipool-google',
            order: 50,
            label: () => SETTINGS.googleLabel,
            locale: 'dsh-multipool',
          },
          GoogleSettings,
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
      dashboardOf: dashboardOf,
      hourOf: hourOf,
      cellsOf: cellsOf,
    }
  },
})
