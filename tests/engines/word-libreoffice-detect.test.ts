import { describe, expect, it } from 'vitest'
import {
  forceLibreOfficeForTests,
  libreOfficeAvailable,
  resetLibreOfficeCache,
  stopForcingLibreOfficeForTests,
} from '../../src/engines/word.js'

describe('LibreOffice detection', () => {
  it('reports a path or undefined, and never throws', async () => {
    resetLibreOfficeCache()
    const path = await libreOfficeAvailable()
    expect(path === undefined || typeof path === 'string').toBe(true)
  })

  it('caches the result — a second call does not repeat the detection work', async () => {
    resetLibreOfficeCache()
    const first = await libreOfficeAvailable()
    const second = await libreOfficeAvailable()
    expect(second).toBe(first)
  })
})

describe('forcing an answer for tests', () => {
  it('overrides the real detection until stopped', async () => {
    forceLibreOfficeForTests('/fake/soffice')
    try {
      expect(await libreOfficeAvailable()).toBe('/fake/soffice')
      forceLibreOfficeForTests(undefined)
      expect(await libreOfficeAvailable()).toBeUndefined()
    } finally {
      stopForcingLibreOfficeForTests()
    }
  })

  it('restores real detection once stopped', async () => {
    forceLibreOfficeForTests('/fake/soffice')
    stopForcingLibreOfficeForTests()
    resetLibreOfficeCache()
    const real = await libreOfficeAvailable()
    expect(real).not.toBe('/fake/soffice')
  })
})
