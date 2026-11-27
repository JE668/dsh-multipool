import { describe, expect, it } from 'vitest'

import {
  AMD_KEY_REFS,
  describeFailure,
  describeKey,
  forgetAmdKey,
  keyStateOf,
  saveAmdKey,
  type CredentialSeam,
  type KeyState,
} from '../src/key-store.js'

const KEY = 'rc-' + 'a'.repeat(24)

function seamOf(overrides: Partial<CredentialSeam> = {}, log: string[] = []): CredentialSeam {
  return {
    resolve: async () => undefined,
    describe: async () => ({ configured: false, writable: true }),
    set: async (ref: string, value: string) => {
      log.push('set ' + ref + ' ' + value)
    },
    unset: async (ref: string) => {
      log.push('unset ' + ref)
    },
    ...overrides,
  }
}

describe('key state: absent is not broken', () => {
  it('reads a configured value and the layer that supplied it', async () => {
    const state = await describeKey(seamOf({ describe: async () => ({ configured: true, source: 'file', writable: true }) }), 'AMD_API_KEY')
    expect(state).toEqual({ kind: 'configured', layer: 'file' })
  })

  it('keeps every layer the seam can name apart', () => {
    const layers = ['file', 'env', 'project-env', 'user-env']
    for (const layer of layers) {
      const state = keyStateOf({ configured: true, source: layer, writable: true })
      expect(state).toEqual({ kind: 'configured', layer })
    }
  })

  it('says absent when nothing is stored, and does not dress it as an error', async () => {
    const state = await describeKey(seamOf(), 'AMD_API_KEY')
    expect(state).toEqual({ kind: 'absent' })
  })

  it('says unavailable when there is no credential service at all', async () => {
    const state = await describeKey(undefined, 'AMD_API_KEY')
    expect(state).toEqual({ kind: 'unavailable' })
  })

  it('keeps a fault apart from an empty field, and scrubs the key out of the fault', async () => {
    const state = await describeKey(
      seamOf({
        describe: async () => {
          throw new Error('store rejected ' + KEY)
        },
      }),
      'AMD_API_KEY',
    )
    expect(state.kind).toBe('refused')
    if (state.kind === 'refused') {
      expect(state.reason).not.toContain(KEY)
      expect(state.reason).toContain('rc-\u2026')
    }
  })

  it('scrubs a thrown value with no message property too', () => {
    expect(describeFailure(KEY)).toBe('rc-\u2026')
  })
})

describe('saving a key: the refusal comes first', () => {
  it('refuses an sk- string before anything is written', async () => {
    const log: string[] = []
    const result = await saveAmdKey(seamOf({}, log), { ref: 'AMD_API_KEY', value: 'sk-' + 'b'.repeat(20) })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.rejection.rule).toBe('C-02')
    expect(log).toEqual([])
  })

  it('refuses the instance-service host before anything is written', async () => {
    const log: string[] = []
    const result = await saveAmdKey(seamOf({}, log), { ref: 'AMD_API_KEY', value: 'rc-x-jupyter.anruicloud.com' })
    expect(result.ok).toBe(false)
    expect(log).toEqual([])
  })

  it('finds no service, so it says the key was not saved and never says it was', async () => {
    const result = await saveAmdKey(undefined, { ref: 'AMD_API_KEY', value: KEY })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.rejection.message).toContain('not saved')
  })

  it('writes the trimmed key only after the check passed', async () => {
    const log: string[] = []
    const result = await saveAmdKey(seamOf({}, log), { ref: 'AMD_API_KEY', value: '  ' + KEY + '  ' })
    expect(result).toEqual({ ok: true, value: KEY })
    expect(log).toEqual(['set AMD_API_KEY ' + KEY])
  })

  it('forgets through unset, never through an empty set()', async () => {
    const log: string[] = []
    await forgetAmdKey(seamOf({}, log), 'AMD_API_KEY')
    expect(log).toEqual(['unset AMD_API_KEY'])
  })
})

describe('the seam is named, not guessed', () => {
  it('lists the reference 02 section 1.2 uses', () => {
    expect(AMD_KEY_REFS).toEqual(['AMD_API_KEY'])
  })

  it('reads the layer from the answer, without borrowing a preview', async () => {
    // 0.2.2-rc.5 builds `masked` for the file layer alone: a key from the environment or a .env
    // file is reported configured with no preview at all. Either way the layer is the whole fact.
    for (const layer of ['env', 'project-env', 'user-env'] as const) {
      const seam = seamOf({ describe: async () => ({ configured: true, source: layer, writable: true }) })
      await expect(describeKey(seam, 'AMD_API_KEY')).resolves.toEqual({ kind: 'configured', layer })
    }
    const fileLayer = seamOf({
      describe: async () => ({ configured: true, source: 'file', writable: true, masked: 'rc-\u2022\u2022\u2022\u2022' }),
    })
    await expect(describeKey(fileLayer, 'AMD_API_KEY')).resolves.toEqual({ kind: 'configured', layer: 'file' })
  })

  it('keeps a layer name the seam supplies, even one this repo has no word for', () => {
    // The seam names a layer; this repo's four spellings are a vocabulary, not a guard. Dropping a
    // fifth name -- or filing it under 'file' -- is key-store.ts answering a question the page asks
    // about itself: which names it has words for (m15329).
    const state = keyStateOf({ configured: true, source: 'ndjson-layer', writable: true })
    expect(state).toEqual({ kind: 'configured', layer: 'ndjson-layer' })
  })

  it('claims file only when the answer named nothing at all', () => {
    // An empty source is the one shape that is genuinely "unnamed": there is no word to keep, and
    // the file layer is what a key with no named source has always meant here.
    for (const source of ['', undefined, null]) {
      const info = source === undefined ? { configured: true, writable: true } : { configured: true, source, writable: true }
      expect(keyStateOf(info)).toEqual({ kind: 'configured', layer: 'file' })
    }
  })

  it('has no state that mixes configured and absent', () => {
    const states: KeyState[] = [
      { kind: 'configured', layer: 'file' },
      { kind: 'absent' },
      { kind: 'unavailable' },
      { kind: 'refused', reason: 'rc-\u2026' },
    ]
    expect(new Set(states.map(state => state.kind)).size).toBe(states.length)
  })
})
