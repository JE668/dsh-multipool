import { beforeEach, describe, expect, it } from 'vitest'

import { CHANNEL_KEY } from '../src/channel.js'
import { KEY_UPDATED_EVENT, type KeyStatus } from '../src/credentials.js'
import { apply } from '../src/index.js'

type Listener = (moved: unknown) => void

interface FakeSeam {
  resolve(ref: string): Promise<undefined>
  describe(ref: string): Promise<{ configured: boolean; source?: string; writable: boolean; masked?: string }>
  set(ref: string, value: string): Promise<void>
  unset(ref: string): Promise<void>
  reads?: number
}

/**
 * A context carrying only what apply() reads, recorded instead of performed.
 * `hasInject: false` stands for a context that predates the inject mixin.
 */
function contextOf(config: { hasInject: boolean; configured?: boolean }) {
  const effects: Array<() => () => void> = []
  const injections: string[] = []
  const listeners: Listener[] = []
  const seam: FakeSeam = {
    resolve: async () => undefined,
    describe: async () => {
      seam.reads = (seam.reads ?? 0) + 1
      return config.configured === true
        ? { configured: true, source: 'file', writable: true, masked: 'rc-\u2022\u2022' }
        : { configured: false, writable: true }
    },
    set: async () => undefined,
    unset: async () => undefined,
  }
  const context = {
    effect(callback: () => () => void): () => void {
      effects.push(callback)
      return () => undefined
    },
    inject: config.hasInject
      ? (names: string[], callback: (child: { credentials: FakeSeam }) => void): (() => void) => {
          injections.push(names.join(','))
          callback({ credentials: seam })
          return () => undefined
        }
      : undefined,
    on(name: string, listener: Listener): () => void {
      expect(name).toBe(KEY_UPDATED_EVENT)
      listeners.push(listener)
      return () => undefined
    },
  }
  return { context, effects, injections, listeners, seam }
}

describe('the host half asks the seam only when somebody is reading the answer', () => {
  beforeEach(() => {
    // apply() writes CHANNEL_KEY onto globalThis; each case starts without it.
    delete (globalThis as Record<string, unknown>)[CHANNEL_KEY]
  })

  it('publishes the channel and asks nothing when no reader is given', () => {
    const { context, effects, injections, seam } = contextOf({ hasInject: true })
    apply(context)
    // apply() only registers its body; the channel is opened when effect() runs it, as cordis does.
    const disposers = effects.map(effect => effect())
    expect(injections).toEqual([])
    expect(seam.reads).toBeUndefined()
    expect((globalThis as Record<string, unknown>)[CHANNEL_KEY]).toBeDefined()

    for (const dispose of disposers) dispose()
    expect((globalThis as Record<string, unknown>)[CHANNEL_KEY]).toBeUndefined()
  })

  it('arms one read through the credentials service when a reader is given', async () => {
    const { context, effects, injections } = contextOf({ hasInject: true })
    const seen: KeyStatus[] = []
    apply(context, { onKeyStatus: status => seen.push(status) })
    const disposers = effects.map(effect => effect())

    expect(injections).toEqual(['credentials'])
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(seen).toHaveLength(1)
    expect(seen[0]?.kind).toBe('read')
    expect(seen[0]?.kind === 'read' ? seen[0].state : undefined).toEqual({ kind: 'absent' })

    for (const dispose of disposers) dispose()
  })

  it('still opens the channel on a context that cannot inject', () => {
    const { context, effects, injections, seam } = contextOf({ hasInject: false })
    apply(context, { onKeyStatus: () => undefined })
    const disposers = effects.map(effect => effect())
    expect(injections).toEqual([])
    expect(seam.reads).toBeUndefined()
    expect((globalThis as Record<string, unknown>)[CHANNEL_KEY]).toBeDefined()
    for (const dispose of disposers) dispose()
    expect((globalThis as Record<string, unknown>)[CHANNEL_KEY]).toBeUndefined()
  })
})
