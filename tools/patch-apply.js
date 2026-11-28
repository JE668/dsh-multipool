export function apply(
  ctx: {
    effect(callback: () => () => void): () => void
    inject?: (names: string[], callback: (child: InjectedServices) => void) => () => void
  },
  options: HostOptions = {},
): () => void {
  const nowMs = options.nowMs ?? (() => createSystemClock().now())
  return ctx.effect(() => {
    // The one object the seam writes into. It starts as NOTHING_READ -- every member absent, none
    // zero -- and only a read that came back may change it, because `reading()` is derived from
    // `accounts` being undefined here and nowhere else.
    const facts: MutableFacts = { ...(options.facts ?? NOTHING_READ) }
    // Both hooks read the current `seam` and `lastAttemptMs` when they are called, so they see a
    // service injected after this line. Whether they are *offered* is decided per request in
    // channel.ts: an install with no provider has no `readFromSeam` key at all, which is that
    // module's refusal, rather than a wrapper that is present and throws.
    let seam: CredentialSeam | undefined
    let lastAttemptMs: number | undefined
    const hooks: SourceHooks = {
      readFromSeam: () => readSeamNow(seam, facts, onKeyStatus),
      testUsage: (providerId: ProviderId) =>
        askUsage(
          providerId,
          seam,
          nowMs,
          () => lastAttemptMs,
          stamp => {
            lastAttemptMs = stamp
          },
          facts,
          () => readSeamNow(seam, facts, onKeyStatus),
        ),
      // The dashboard's timer asks the same question a press asks, through the same function, so
      // both are floored by the one lastAttemptMs. What differs is who is waiting: a page that polls
      // gets a carried reading inside the minute (usage.ts returns `previous` with carried: true)
      // rather than a refusal, which is why this is not a "you may not" -- there is nothing here to
      // gate that the upstream floor does not already gate.
      readUsage: (providerId: ProviderId) =>
        askUsage(
          providerId,
          seam,
          nowMs,
          () => lastAttemptMs,
          stamp => {
            lastAttemptMs = stamp
          },
          facts,
          () => readSeamNow(seam, facts, onKeyStatus),
        ),
      // The table half is capped to the same hour the curve covers, so the two cannot disagree
      // about how far back this page is talking. Nothing here reads the clock for itself: nowMs
      // is the one the facts were built with, and trendOf() floors it.
      readDashboard: () => {
        const events = facts.events ?? []
        return {
          trend: trendOf(events, nowMs(), READING_MINUTES),
          rows: rowsOf(events, READING_ROWS),
        }
      },
    }
    const source: ChannelSource = channelSourceFrom(facts, nowMs, hooks)
    const budget: IconBudget = RAIL_BUDGET
    const channel = openChannel({ source, budget })
    const drops: Array<() => void> = []

    const server = options.server
    if (server === undefined) {
      drops.push(injectOf(ctx, [WEB_SERVER_SERVICE], child => {
        const webServer = child.webServer
        if (webServer === undefined) return
        drops.push(serveOn(webServer, channel, channel.source))
      }))
    } else {
      drops.push(serveOn(server, channel, channel.source))
    }

    // Asked for unconditionally, which is the point of T-2-b's last leg. This injection used to be
    // armed only when a reader or a writer had been handed in, and an install the user merely enabled
    // hands in neither -- so the seam was never resolved, the facts never said who was there, and the
    // icon painted 0/0: a confident number about a pool nobody had looked .A reason to
    // paint is a reason to read, and the icon always has one.
    const onKeyStatus = options.onKeyStatus
    // The seam is assigned here and read by `hooks` at request time, so the route above and this
    // service need no ordering between them.
    drops.push(injectOf(ctx, [CREDENTIALS_SERVICE], child => {
      // The seam arrives here, possibly long after the route was claimed: `hooks` reads this
      // variable when it is called, so it sees whatever this line last assigned.
      seam = child.credentials
      // No seam at all stays indistinguishable from one that has not answered yet, and both read as
      // 'unread' downstream. That is deliberate: "I could not tell" is not "there are none".
      if (seam === undefined) return
      drops.push(reportKeyInto(child, facts, onKeyStatus))
      // The write half is handed to the page, not used here. apply() still writes nothing itself.
      if (options.acceptsWrites !== false) channel.offer(writesFor(seam))
    }))

    return () => {
      for (const drop of drops.reverse()) drop()
      channel.close()
    }
  })
}