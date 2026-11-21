import { describe, expect, it } from 'vitest'

import { AMD_KEY_REF, CREDENTIALS_SERVICE, readKeyStatus } from '../src/credentials.js'

function seamOf(describeImpl: () => Promise<{ configured: boolean; source?: string; writable: boolean; masked?: string }>): {
  resolve(ref: string): Promise<undefined | { value: string; source?: string }>
  describe(ref: string): Promise<{ configured: boolean; source?: string; writable: boolean; masked?: string }>
  set(ref: string, value: string): Promise<void>
  unset(ref: string): Promise<void>
} {
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

    const absent = await readKeyStatus({ credentials: seamOf(async () => ({ configured: false, writable: true })) })
    expect(absent.kind).toBe('read')
    expect(absent.kind === 'read' ? absent.state : undefined).toEqual({ kind: 'absent' })

    const noService = await readKeyStatus({})
    expect(noService).toEqual({ kind: 'no-service' })
  })

  it('would notice a write, because it makes none', async () => {
    const calls: string[] = []
    const status = await readKeyStatus(
      {
        credentials: {
          resolve: async ref => {
            calls.push('resolve ' + ref)
            return undefined
          },
          describe: async ref => {
            calls.push('describe ' + ref)
            return { configured: true, source: 'env', writable: true }
          },
          set: async (ref, value) => {
            calls.push('set ' + ref + ' ' + value)
          },
          unset: async ref => {
            calls.push('unset ' + ref)
          },
        },
      },
      'AMD_API_KEY',
    )
    // An inherited key has no preview to borrow (0.2.2-rc.5), and this module does not invent one.
    expect(status).toEqual({ kind: 'read', state: { kind: 'configured', layer: 'env' }, seam: expect.anything() })
    expect(calls).toEqual(['describe AMD_API_KEY'])
  })
})
