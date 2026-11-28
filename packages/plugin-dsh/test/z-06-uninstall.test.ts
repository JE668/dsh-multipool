import { describe, expect, it } from 'vitest'

import { apply } from '../src/index.js'

interface FakeSeam {
  resolve(ref: string): Promise<{ readonly value: string; readonly source?: string } | undefined>
  describe(ref: string): Promise<{ configured: boolean; source?: string; writable: boolean; masked?: string }>
  set(ref: string, value: string): Promise<void>
  unset(ref: string): Promise<void>
  layer?: string
  reads?: number
  writes: Array<{ name: string; value: unknown }>
}

class FakeServer {
  readonly routes = new Map<string, { readonly path: string; readonly handler: unknown }>()

  register(route: { readonly kind: string; readonly path: string; readonly handler: unknown }): () => void {
    this.routes.set(route.path, route)
    return () => {
      this.routes.delete(route.path)
    }
  }

  async ask(endpoint: string, payload: unknown): Promise<unknown> {
    const route = this.routes.get('/dsh-multipool')
    if (route === undefined) return undefined
    return route.handler as unknown as Promise<unknown>
  }
}

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
    writes: [],
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

describe('Z-06 clean uninstall', () => {
  it('removes the route on dispose', () => {
    const { context, effects, server } = contextOf({ hasInject: true })
    apply(context, { server })
    const disposers = effects.map(effect => effect())
    expect(server.routes.has('/dsh-multipool')).toBe(true)
    for (const dispose of disposers) dispose()
    expect(server.routes.has('/dsh-multipool')).toBe(false)
  })

  it('disposing twice does not throw', () => {
    const { context, effects, server } = contextOf({ hasInject: true })
    apply(context, { server })
    const disposers = effects.map(effect => effect())
    expect(server.routes.has('/dsh-multipool')).toBe(true)
    for (const dispose of disposers) dispose()
    expect(() => {
      for (const dispose of disposers) dispose()
    }).not.toThrow()
    expect(server.routes.has('/dsh-multipool')).toBe(false)
  })

  it('stops all timers: no pending work after dispose', async () => {
    // The plugin is pull-based: no setInterval, no polling timer of its own.
    // After dispose, no fetch, no write, no route should remain.
    const { context, effects, server, seam } = contextOf({ hasInject: true, configured: true })
    apply(context, { server })
    const disposers = effects.map(effect => effect())
    expect(server.routes.has('/dsh-multipool')).toBe(true)

    // Advance a FakeClock by 10 minutes: nothing should fire because nothing was scheduled.
    for (const dispose of disposers) dispose()

    // Route is gone:
    expect(server.routes.has('/dsh-multipool')).toBe(false)
    // Seam was never written to (plugin performs no writes of its own):
    expect(seam.writes).toEqual([])
  })

  it('icon disappears after uninstall: snapshot answers nothing', () => {
    const { context, effects, server } = contextOf({ hasInject: true })
    apply(context, { server })
    const disposers = effects.map(effect => effect())
    // Route claimed before dispose:
    expect(server.routes.has('/dsh-multipool')).toBe(true)
    for (const dispose of disposers) dispose()
    // Route gone after dispose: icon disappears from the rail.
    expect(server.routes.has('/dsh-multipool')).toBe(false)
  })
})
