import { describe, expect, it } from 'vitest'
import { colourUsage } from '../../src/cli/args.js'
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

    expect(colourUsage('palette', 'win32')).toContain('pipe to clip and paste into Figma')
  })
})

describe('wording on Linux', () => {
  it('names Linux answers: apt, Ctrl+V and wl-copy, never Homebrew or ⌘', () => {
    expect(basicFidelityWarning('linux').message).toContain(
      'Install LibreOffice for full-fidelity conversion: sudo apt install libreoffice',
    )
    expect(basicFidelityWarning('linux').message).not.toContain('brew')

    expect(instructionsFor('linux')).toMatch(/on this computer, locally\./)

    const text = copiedRow(modePalette(DARK, 'colour'), { count: 11 }, 'linux')
      .map((r) => r.text)
      .join('')
    expect(text).toContain('paste into Figma with Ctrl+V')

    for (const which of ['palette', 'scale'] as const) {
      expect(colourUsage(which, 'linux')).toContain('pipe to wl-copy and paste into Figma')
      expect(colourUsage(which, 'linux')).not.toContain('pbcopy')
    }
  })
})

describe('the Mac’s words, unchanged', () => {
  it('keeps the colour usage it always printed', () => {
    expect(colourUsage('scale', 'darwin')).toBe(`Usage: forge scale <colour> [--json] [--svg]

50–950 built in OKLCH, with <colour> at 500. Pass the hex without #, or quote it.
  --json            one JSON document: scale.steps[] with hex, oklch, white, black
  --svg             a card of swatches; pipe to pbcopy and paste into Figma
`)
    expect(
      colourUsage('palette', 'darwin'),
    ).toBe(`Usage: forge palette <image> [--json] [--svg] [--inside <hex>]

An image's main colours, most of the image first.
  --json            one JSON document: palette.colours[] with hex, rgb, oklch, share
  --svg             a card of swatches; pipe to pbcopy and paste into Figma
  --inside <hex>    the shades of the palette colour nearest <hex>
`)
    for (const platform of ['darwin', 'win32', 'linux'] as const)
      for (const which of ['palette', 'scale'] as const)
        for (const line of colourUsage(which, platform).split('\n'))
          if (line.includes('--svg  ')) expect([...line].length).toBeLessThanOrEqual(80)
  })
})
