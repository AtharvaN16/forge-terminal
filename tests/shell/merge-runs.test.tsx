import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import { Runs } from '../../src/shell/components/Home.js'
import { mergeRuns, type Row, surfaceRows } from '../../src/shell/home-art.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { DARK, modePalette } from '../../src/shell/theme.js'

/** Truecolor, read by chalk once at import — so set before Ink loads. */
vi.hoisted(() => {
  process.env.FORCE_COLOR = '3'
})

describe('mergeRuns', () => {
  it('joins neighbours drawn alike into one run', () => {
    const row: Row = [
      { text: ' ', bg: '#2c2c2c' },
      { text: ' ', bg: '#2c2c2c' },
      { text: '·', fg: '#808080', bg: '#2c2c2c' },
      { text: '·', fg: '#808080', bg: '#2c2c2c' },
      { text: ' ', bg: '#2c2c2c' },
    ]
    expect(mergeRuns(row)).toEqual([
      { text: '  ', bg: '#2c2c2c' },
      { text: '··', fg: '#808080', bg: '#2c2c2c' },
      { text: ' ', bg: '#2c2c2c' },
    ])
  })

  it('keeps apart runs that differ in colour, background or weight', () => {
    const row: Row = [
      { text: 'a', fg: '#ffffff' },
      { text: 'b', fg: '#fffffe' },
      { text: 'c', fg: '#fffffe', bg: '#000000' },
      { text: 'd', fg: '#fffffe', bg: '#000000', bold: true },
    ]
    expect(mergeRuns(row)).toEqual(row)
  })

  it('takes no colour and an empty colour as the same, and no weight as not bold', () => {
    expect(
      mergeRuns([
        { text: 'a', fg: '' },
        { text: 'b' },
        { text: 'c', bold: false },
        { text: 'd', bg: '' },
      ]),
    ).toEqual([{ text: 'abcd', fg: '' }])
  })

  it('leaves the row it was given alone', () => {
    const row: Row = [
      { text: 'a', fg: '#ffffff' },
      { text: 'b', fg: '#ffffff' },
    ]
    mergeRuns(row)
    expect(row).toEqual([
      { text: 'a', fg: '#ffffff' },
      { text: 'b', fg: '#ffffff' },
    ])
  })
})

describe('Runs', () => {
  it('draws a merged row exactly as it drew each cell on its own', () => {
    const palette = modePalette(DARK, 'convert')
    const rows = surfaceRows({
      width: 120,
      rows: 12,
      palette,
      mode: 'convert',
      typing: false,
      kinds: 'images',
    })
    const drawn = (row: Row) => {
      const app = render(
        <ThemeProvider palette={palette}>
          <Runs row={row} />
        </ThemeProvider>,
      )
      const frame = app.lastFrame()
      app.unmount()
      return frame
    }
    for (const row of rows) expect(drawn(mergeRuns(row))).toBe(drawn(row))
  })
})
