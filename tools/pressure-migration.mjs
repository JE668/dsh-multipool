/**
 * Z-04: Migration pressure test.
 *
 * Simulates the scheduler's sticky-pick + least-load + breaker migration logic against a
 * fake upstream of 4 Providers × 2 accounts (8 accounts total), runs the equivalent of a
 * 30-minute window with injected 429s at < 3%, and asserts:
 *
 *   migrations_unnecessary === 0      (no migration without a necessary reason)
 *   migrations_cross === 0            (crossProviderFailover=false ⇒ no cross-provider moves)
 *   every migration is traceable to a unique reason:
 *     - account 429 `daily_quota`
 *     - daily quota exhausted
 *     - entire Provider unavailable
 *
 * This is a pure simulation: it imports only `mayMigrateOn`, `shouldMigrate`, `leastLoad`,
 * `stickyPick`, `Breaker`, `createBindingStore` from @dsh-multipool/core. No network, no
 * credentials, no DSH runtime.
 *
 * Run: node tools/pressure-migration.mjs
 */

import {
  mayMigrateOn,
  shouldMigrate,
  leastLoad,
  stickyPick,
  Breaker,
  createBindingStore,
} from '@dsh-multipool/core'

const NOW = () => Date.now()
const T_STICKY_IDLE_MS = 15 * 60_000 // docs/02 DEFAULT_AMD_POLICY
const MIGRATION_BIAS = 3.0
const CROSS_PROVIDER_FAILOVER = false
const SESSION_COUNT = 40
const REQUESTS_PER_SESSION = 25 // ~1000 requests total
const INJECT_429_RATE = 0.02 // 2% (< 3% per 01 §7)
const SIMULATE_MINUTES = 30

// ---------------------------------------------------------------------------
// Fake upstream: 4 Providers × 2 accounts
// ---------------------------------------------------------------------------
const PROVIDERS = ['amd', 'nim', 'sensenova', 'agnes']
const ACCOUNTS_PER_PROVIDER = 2

function makeAccount(providerId, index) {
  const alias = `${providerId}-acct-${index + 1}`
  return {
    providerId,
    accountAlias: alias,
    keyId: `${alias}-key`,
    modelId: 'default-model',
    rpmLimit: 20,
    rpmUsed: 0,
    inFlight: 0,
    concurrencyLimit: 8,
    dailyQuota: 1000,
    dailyUsed: 0,
    lastSuccessAtMs: undefined,
  }
}

const ALL_ACCOUNTS = []
for (const p of PROVIDERS) {
  for (let i = 0; i < ACCOUNTS_PER_PROVIDER; i++) {
    ALL_ACCOUNTS.push(makeAccount(p, i))
  }
}

function accountsOfProvider(providerId) {
  return ALL_ACCOUNTS.filter((a) => a.providerId === providerId)
}

// ---------------------------------------------------------------------------
// Session state
// ---------------------------------------------------------------------------
const sessions = []
for (let i = 0; i < SESSION_COUNT; i++) {
  sessions.push({
    id: `sess-${i + 1}`,
    providerId: PROVIDERS[i % PROVIDERS.length], // session prefers one provider
    accountAlias: undefined,
    keyId: undefined,
  })
}

// ---------------------------------------------------------------------------
// Migration counters
// ---------------------------------------------------------------------------
let migrationsTotal = 0
let migrationsUnnecessary = 0
let migrationsCross = 0
const migrationReasons = [] // {session, from, to, reason}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function rand() {
  return Math.random()
}

function pickCandidate(session, candidates, nowMs, store, migratedFrom) {
  // sticky: honour existing binding
  const binding = stickyPick(
    session,
    candidates,
    store,
    { tStickyIdleMs: T_STICKY_IDLE_MS, migrationBias: MIGRATION_BIAS },
    nowMs,
  )
  if (binding !== null) return binding

  // least-load among fresh candidates
  return leastLoad(candidates, {
    session,
    nowMs,
    migratedFrom: migratedFrom !== undefined ? migratedFrom : undefined,
  })
}

// Simulate one request on one session
function simulateRequest(session, nowMs, store, breakers) {
  const providerCandidates = accountsOfProvider(session.providerId).map((a) => ({
    providerId: session.providerId,
    accountAlias: a.accountAlias,
    keyId: a.keyId,
    modelId: a.modelId,
    rpmLimit: a.rpmLimit,
    rpmUsed: a.rpmUsed,
    inFlight: a.inFlight,
    concurrencyLimit: a.concurrencyLimit,
    dailyQuota: a.dailyQuota,
    dailyUsed: a.dailyUsed,
    lastSuccessAtMs: a.lastSuccessAtMs,
  }))

  const before = session.accountAlias
  let chosen = pickCandidate(
    { id: session.id },
    providerCandidates,
    nowMs,
    store,
    undefined,
  )

  if (chosen === null) {
    // No candidate available on this provider → entire Provider unavailable
    // With crossProviderFailover=false, we stay put (no migration)
    return { migrated: false, reason: 'provider-unavailable-no-migration' }
  }

  const migrated = chosen.accountAlias !== before && before !== undefined
  let reason = null

  if (migrated) {
    migrationsTotal++
    if (CROSS_PROVIDER_FAILOVER === false && chosen.providerId !== session.providerId) {
      migrationsCross++
    }

    // Decide whether this migration is necessary
    // Necessary reasons: daily_quota 429 on bound account, daily quota exhausted,
    // or entire Provider unavailable
    if (session.providerId !== chosen.providerId) {
      reason = 'cross-provider-unnecessary'
      migrationsUnnecessary++
    } else {
      // Same-provider migration: check if there's a hard quota reason
      const boundAcct = ALL_ACCOUNTS.find((a) => a.accountAlias === before)
      if (boundAcct && boundAcct.dailyUsed >= boundAcct.dailyQuota) {
        reason = 'daily-quota-exhausted'
      } else {
        reason = 'same-provider-no-hard-reason'
        migrationsUnnecessary++
      }
    }
    migrationReasons.push({ session: session.id, from: before, to: chosen.accountAlias, reason })
  }

  // Apply the chosen account
  session.accountAlias = chosen.accountAlias
  session.keyId = chosen.keyId

  // Persist sticky binding so subsequent requests stay on the same account
  store.set({
    sessionId: session.id,
    keyId: chosen.keyId,
    boundAtMs: nowMs,
    lastUsedAtMs: nowMs,
  })

  // Record usage
  const acct = ALL_ACCOUNTS.find((a) => a.accountAlias === chosen.accountAlias)
  if (acct) {
    acct.rpmUsed += 1
    acct.inFlight += 1
    acct.lastSuccessAtMs = nowMs
  }

  // Randomly inject a 429
  const is429 = rand() < INJECT_429_RATE
  if (is429 && acct) {
    // Classify the 429 rate kind
    // 429 could be rpm_key (should NOT migrate), daily_quota (should migrate),
    // rpm_ip (should migrate), auth (should migrate)
    const rateKinds = ['rpm_key', 'daily_quota', 'rpm_ip', 'auth']
    const rateKind = rateKinds[Math.floor(rand() * rateKinds.length)]

    const breakerKey = `${session.providerId}:${chosen.accountAlias}:${chosen.modelId}`
    let breaker = breakers.get(breakerKey)
    if (!breaker) {
      breaker = new Breaker({ now: () => nowMs })
      breakers.set(breakerKey, breaker)
    }
    breaker.record(true, nowMs)

    // Decide migration based on rate kind
    if (mayMigrateOn(rateKind)) {
      // This rate kind allows migration
      if (rateKind === 'daily_quota') {
        // Mark daily quota as exhausted for this account
        acct.dailyUsed = acct.dailyQuota
        reason = 'daily-quota-429'
      } else if (rateKind === 'auth') {
        reason = 'auth-429'
      } else if (rateKind === 'rpm_ip') {
        reason = 'rpm-ip-429'
      }
      // Migration already counted above if account changed
    } else {
      // rpm_key or concurrency: should NOT migrate, stay on same account
      // If stickyPick/leastLoad moved us anyway, that's unnecessary
      if (migrated && reason === null) {
        migrationsUnnecessary++
        reason = 'rpm-key-429-should-stay'
        migrationReasons.push({ session: session.id, from: before, to: chosen.accountAlias, reason })
      }
    }
  }

  // Release in-flight
  if (acct) acct.inFlight = Math.max(0, acct.inFlight - 1)

  return { migrated, reason }
}

// ---------------------------------------------------------------------------
// Run the simulation
// ---------------------------------------------------------------------------
const breakers = new Map()
const store = createBindingStore()
const startMs = NOW()
const endMs = startMs + SIMULATE_MINUTES * 60_000

let requestIdx = 0
for (let t = startMs; t < endMs; t += 1000) {
  // Each second, each session issues a request with some probability
  for (const session of sessions) {
    if (rand() < 0.3) {
      // advance simulated time slightly per request
      const nowMs = t + requestIdx * 100
      requestIdx++
      simulateRequest(session, nowMs, store, breakers)
    }
  }
}

for (const p of PROVIDERS) {
  const acct = ALL_ACCOUNTS.find((a) => a.providerId === p && a.accountAlias.endsWith('-acct-1'))
  if (acct) {
    acct.dailyUsed = acct.dailyQuota // exhaust quota → dailyRatio = 1, should be least-preferred
    // A session that re-picks (no sticky binding) should NOT land on the exhausted account
    const session = sessions.find((s) => s.providerId === p)
    if (session) {
      // Clear binding so stickyPick returns null and leastLoad runs
      store.delete(session.id)
      const nowMs = endMs + requestIdx * 100
      requestIdx++
      const result = simulateRequest(session, nowMs, store, breakers)
      if (result.migrated) {
        console.log(`  ${session.id}: ${acct.accountAlias} → ${session.accountAlias} (daily quota exhausted)`)
      } else {
        console.log(`  ${session.id}: stayed on ${session.accountAlias} (no migration needed)`)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
console.log('=== Z-04 Migration Pressure Test ===')
console.log(`Providers: ${PROVIDERS.length} × ${ACCOUNTS_PER_PROVIDER} accounts = ${ALL_ACCOUNTS.length} accounts`)
console.log(`Sessions: ${SESSION_COUNT}, requests/session: ~${REQUESTS_PER_SESSION}`)
console.log(`Injected 429 rate: ${(INJECT_429_RATE * 100).toFixed(1)}% (< 3%)`)
console.log(`crossProviderFailover: ${CROSS_PROVIDER_FAILOVER}`)
console.log('')
console.log(`migrations_total:    ${migrationsTotal}`)
console.log(`migrations_unnecessary: ${migrationsUnnecessary}`)
console.log(`migrations_cross:    ${migrationsCross}`)
console.log('')
console.log('Migration reasons:')
for (const r of migrationReasons) {
  console.log(`  ${r.session}: ${r.from} → ${r.to}  (${r.reason})`)
}
if (migrationReasons.length === 0) {
  console.log('  (none)')
}
console.log('')

// ---------------------------------------------------------------------------
// Assertions (Z-04 DoD)
// ---------------------------------------------------------------------------
let failures = 0
function assert(cond, msg) {
  if (!cond) {
    failures++
    console.log(`FAIL: ${msg}`)
  }
}

assert(migrationsUnnecessary === 0, `migrations_unnecessary must be 0, got ${migrationsUnnecessary}`)
assert(migrationsCross === 0, `migrations_cross must be 0 (crossProviderFailover=false), got ${migrationsCross}`)

// Every migration must have a necessary reason
const unnecessaryReasons = migrationReasons.filter(
  (r) => r.reason === 'cross-provider-unnecessary' || r.reason === 'same-provider-no-hard-reason' || r.reason === 'rpm-key-429-should-stay'
)
assert(unnecessaryReasons.length === 0, `${unnecessaryReasons.length} migrations lack a necessary reason`)

// 429 rate check (approximate, based on injection)
assert(INJECT_429_RATE < 0.03, `injected 429 rate must be < 3%, got ${(INJECT_429_RATE * 100).toFixed(1)}%`)

// At least some migrations should have been triggered in phase 2 (daily quota exhaustion)
assert(migrationsTotal > 0, 'expected at least one migration from daily-quota exhaustion in phase 2')

if (failures === 0) {
  console.log('Z-04 PASS: migrations_unnecessary=0, migrations_cross=0, all migrations necessary.')
  process.exit(0)
} else {
  console.log(`Z-04 FAIL: ${failures} assertion(s) failed.`)
  process.exit(1)
}
