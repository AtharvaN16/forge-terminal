import { describe, expect, it } from 'vitest'
import { basicFidelityWarning, sofficeArgs } from '../../src/engines/word.js'
import { instructionsFor } from '../../src/mcp/server.js'
import { copiedRow } from '../../src/shell/colour/colour-art.js'
import { DARK, modePalette } from '../../src/shell/theme.js'

describe('LibreOffice', () => {
  it('on Windows gets a real file URL for its profile', () => {
    const args = sofficeArgs('C:\\Users\\Ann Lee\\Temp\\forge-word-1', 'C:\\a.docx', 'pdf', 'win32')
    expect(args[0]).toBe(
      '-env:UserInstallation=file:///C:/Users/Ann%20Lee/Temp/forge-word-1/profile',
    )
  })

  it('on macOS keeps the string it always had', () => {
    expect(sofficeArgs('/tmp/forge-word-1', '/a.docx', 'pdf', 'darwin')).toEqual([
      '-env:UserInstallation=file:///tmp/forge-word-1/profile',
      '--headless',
      '--convert-to',
      'pdf',
      '--outdir',
      '/tmp/forge-word-1',
      '/a.docx',
    ])
  })
})

describe('wording on Windows', () => {
  it('names a PC and Windows answers, not a Mac and Homebrew', () => {
    expect(basicFidelityWarning('win32').message).toContain(
      'Install LibreOffice from libreoffice.org',
    )
    expect(basicFidelityWarning('win32').message).not.toContain('brew')
    expect(basicFidelityWarning('darwin').message).toContain('brew install --cask libreoffice')

    expect(instructionsFor('win32')).toMatch(
      /^Forge converts, compresses and edits files on this PC/,
    )
    expect(instructionsFor('darwin')).toMatch(/on this Mac, locally\./)

    const text = (platform: NodeJS.Platform) =>
      copiedRow(modePalette(DARK, 'colour'), { count: 11 }, platform)
        .map((r) => r.text)
        .join('')
    expect(text('win32')).toContain('paste into Figma with Ctrl+V')
    expect(text('darwin')).toContain('paste into Figma with ⌘V')
  })
})
