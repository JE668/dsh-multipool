import { describe, expect, it } from 'vitest'

import {
  AMD_KEY_REF,
  CREDENTIALS_SERVICE,
  KEY_UPDATED_EVENT,
  readKeyStatus,
  watchKeyStatus,
  type KeyStatus,
} from '../src/credentials.js'

type Info = { configured: boolean; source?: string; writable: boolean; masked?: string }

function seamOf(describeImpl: () => Promise<Info>) {
  return {
    resolve: async () => undefined,
    describe: describeImpl,
    set: async () => undefined,
    unset: async () => undefined,
  }
}

describe('reading the key never writes it', () => {
  it('separates "nothing stored" from "no service to ask"', async () => {
    expect(CREDENTIALS_SERVICE).toBe('credentials')
    expect(AMD_KEY_REF).toBe('AMD_API_KEY')
    expect(KEY_UPDATED_EVENT).toBe('credentials/reference-updated')

    const absent = await readKeyStatus({ credentials: seamOf(async () => ({ configured: false, writable: true })) })
    expect(absent.kind).toBe('read')
    expect(absent.kind === 'read' ? absent.state : undefined).toEqual({ kind: 'absent' })

    const noService = await readKeyStatus({})
    expect(noService).toEqual({ kind: 'no-service' })
  })

  it('would notice a write, because it makes none', async () => {
    const calls: string[] = []
    const status = await readKeyStatus({
      credentials: {
        resolve: async ref => {
          calls.push('resolve ' + ref)
          return undefined
        },
        describe: async ref => {
          calls.push('describe ' + ref)
          return { configured: true, source: 'env', writable: true }
        },
        set: async (ref: string, value: string) => {
          calls.push('set ' + ref + ' ' + value)
        },
        unset: async ref => {
          calls.push('unset ' + ref)
        },
      },
    })
    // An inherited key has no preview to borrow (0.2.2-rc.5), and this module invented none.
    expect(status).toEqual({ kind: 'read', state: { kind: 'configured', layer: 'env' }, seam: expect.anything() })
    expect(calls).toEqual(['describe AMD_API_KEY'])
  })
})

// watchKeyStatus chains describeKey.then().then(settle); a timer tick is a macrotask and clears both.
const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

describe('re-reading follows the seam, not a timer', () => {
  it('reads once on arming, then once per event that names this reference', async () => {
    let reads = 0
    const listeners: Array<(moved: unknown) => void> = []
    let forgetting = 0

    const context = {
      credentials: seamOf(async () => {
        reads += 1
        return { configured: false, writable: true }
      }),
      on(name: string, listener: (...args: readonly unknown[]) => void): () => void {
        expect(name).toBe(KEY_UPDATED_EVENT)
        listeners.push(listener as (moved: unknown) => void)
        return () => {
          forgetting += 1
        }
      },
    }

    const seen: KeyStatus[] = []
    const stop = watchKeyStatus(context, status => seen.push(status))
    await flush()
    expect(listeners).toHaveLength(1)
    expect(seen).toEqual([{ kind: 'read', state: { kind: 'absent' }, seam: expect.anything() }])

    listeners[0]?.('SOMEONE_ELSES_KEY')
    await Promise.resolve()
    expect(reads).toBe(1)

    listeners[0]?.(AMD_KEY_REF)
    await flush()
    expect(reads).toBe(2)

    stop()
    expect(forgetting).toBe(1)
    listeners[0]?.(AMD_KEY_REF)
    await flush()
    expect(reads).toBe(2)
    expect(seen).toHaveLength(2)
  })

  it('still answers a context that cannot subscribe', async () => {
    const seen: KeyStatus[] = []
    watchKeyStatus({}, status => seen.push(status))
    await flush()
    expect(seen).toEqual([{ kind: 'no-service' }])
  })
})
