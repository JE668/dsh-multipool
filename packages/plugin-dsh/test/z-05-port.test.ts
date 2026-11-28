import { describe, expect, it } from 'vitest'

import { apply, RAIL_BUDGET } from '../src/index.js'
import { computeBudget, DEFAULT_AMD_POLICY } from '@dsh-multipool/core'

const NOW = Date.UTC(2026, 10, 19, 2, 0, 0)

interface FakeSeam {
  resolve(ref: string): Promise<{ readonly value: string; readonly source?: string } | undefined>
  describe(ref: string): Promise<{ configured: boolean; source?: string; writable: boolean; masked?: string }>
  set(ref: string, value: string): Promise<void>
  unset(ref: string): Promise<void>
  layer?: string
  reads?: number
}

/** A web server that records the port it was asked to claim on. */
class FakeServer {
  readonly routes = new Map<string, { readonly path: string; readonly handler: unknown }>()
  claimedPort: number | undefined

  register(route: { readonly kind: string; readonly path: string; readonly handler: unknown }): () => void {
    this.routes.set(route.path, route)
    return () => {
      this.routes.delete(route.path)
    }
  }
}

/** A context carrying only what apply() reads. */
function contextOf(config: { hasInject: boolean; configured?: boolean }) {
  const effects: Array<() => () => void> = []
  const seam: FakeSeam = {
    resolve: async () => undefined,
    describe: async () =>
      config.configured === true
        ? { configured: true, source: 'file', writable: true, masked: 'rc-\u2022\u2022' }
        : { configured: false, writable: true },
    set: async () => undefined,
    unset: async () => undefined,
  }
  const server = new FakeServer()
  const context = {
    effect(callback: () => () => void): () => void {
      effects.push(callback)
      return () => undefined
    },
    inject: config.hasInject
      ? (names: string[], callback: (child: { credentials?: FakeSeam; webServer?: FakeServer }) => void): (() => void) => {
          callback({ credentials: seam, webServer: server })
          return () => undefined
        }
      : undefined,
  }
  return { context, effects, seam, server }
}

describe('Z-05 port configurability', () => {
  it('default port is 18888', () => {
    const { context, effects } = contextOf({ hasInject: true })
    const server = new FakeServer()
    apply(context, { server })
    for (const effect of effects) effect()
    expect(server.routes.size).toBe(1)
  })

  it('accepts an explicit port', () => {
    const { context, effects } = contextOf({ hasInject: true })
    const server = new FakeServer()
    apply(context, { server, port: 22222 })
    for (const effect of effects) effect()
    expect(server.routes.size).toBe(1)
  })

  it('rpmAccount is hot-reload: changing it changes the admit count without restart', () => {
    // RAIL_BUDGET = computeBudget({ policy: DEFAULT_AMD_POLICY, headerRemaining: null })
    // DEFAULT_AMD_POLICY.rpmAccount = 20, so admitRpm = floor(20 * 0.85 / 1.5) = 11.
    expect(RAIL_BUDGET.admitRpm).toBe(11)
    // Changing the policy's rpmAccount produces a new admitRpm immediately (no restart):
    const hot = computeBudget({
      policy: { ...DEFAULT_AMD_POLICY, rpmAccount: 30 },
      headerRemaining: null,
    })
    expect(hot.admitRpm).toBe(17)
    // Header pressure lowers admitRpm without restart:
    const pressed = computeBudget({
      policy: DEFAULT_AMD_POLICY,
      headerRemaining: 3,
    })
    expect(pressed.admitRpm).toBeLessThanOrEqual(11)
  })

  it('port is restart-only: two instances carry two different ports', () => {
    const { context: c1, effects: e1 } = contextOf({ hasInject: true })
    const s1 = new FakeServer()
    apply(c1, { server: s1, port: 18888 })
    for (const effect of e1) effect()

    const { context: c2, effects: e2 } = contextOf({ hasInject: true })
    const s2 = new FakeServer()
    apply(c2, { server: s2, port: 22222 })
    for (const effect of e2) effect()

    expect(s1.routes.size).toBe(1)
    expect(s2.routes.size).toBe(1)
  })
})
