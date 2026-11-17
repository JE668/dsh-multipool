import { describe, it, expect } from 'vitest'
import { VERSION } from '../src/index.js'

describe('plugin-dsh smoke', () => {
  it('exposes a version', () => {
    expect(VERSION).toMatch(/^[0-9]+[.][0-9]+[.][0-9]+/)
  })
})
