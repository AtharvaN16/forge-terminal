import { describe, expect, it } from 'vitest'
import {
  forceLibreOfficeForTests,
  getResolveCallCountForTests,
  libreOfficeAvailable,
  resetLibreOfficeCache,
  sofficeCandidates,
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
    await libreOfficeAvailable()
    const afterFirst = getResolveCallCountForTests()
    await libreOfficeAvailable()
    expect(getResolveCallCountForTests()).toBe(afterFirst)
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

describe('sofficeCandidates', () => {
  it('on darwin is the Homebrew cask location', () => {
    expect(sofficeCandidates('darwin', {})).toEqual([
      '/Applications/LibreOffice.app/Contents/MacOS/soffice',
    ])
  })

  it('on win32 is 64-bit then 32-bit Program Files, taken from the environment', () => {
    expect(
      sofficeCandidates('win32', { ProgramFiles: 'D:\\Apps', 'ProgramFiles(x86)': 'D:\\Apps86' }),
    ).toEqual([
      'D:\\Apps\\LibreOffice\\program\\soffice.exe',
      'D:\\Apps86\\LibreOffice\\program\\soffice.exe',
    ])
    expect(sofficeCandidates('win32', {})[0]).toBe(
      'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
    )
  })
})
