import stringWidth from 'string-width'
import { describe, expect, it } from 'vitest'
import { errorLine, errorPanel } from '../../src/shell/error-art.js'
import { type Row, width as rowWidth } from '../../src/shell/home-art.js'
import { DARK, LIGHT, NEUTRAL, type Palette } from '../../src/shell/theme.js'
import {
  describeRow,
  type FixtureFrame,
  fixtureRow,
  loadFixture,
  runsRow,
  shifted,
} from './home-cells.js'

/** E5 and E5·b, from scripts/errors-mockup-fixture.mjs. */
const FRAMES = loadFixture('errors-mockup.json') as Array<FixtureFrame & { kind: string }>
const frame = (label: string) => FRAMES.find((f) => f.label === label) as FixtureFrame

const TINT = '#2e2020'
const W = 76

/** The mockup's rows that are on the tint, as the app draws them: flush left. */
function tinted(f: FixtureFrame) {
  const rows = f.rows.map((_, i) => i).filter((i) => fixtureRow(f, i).some((c) => c.bg === TINT))
  return rows.map((i) => shifted(fixtureRow(f, i)))
}

const text = (row: Row) => row.map((r) => r.text).join('')

describe('E5, the panel for a run that failed, against the mockup', () => {
  const E5 = {
    'E5 · write': {
      title: 'Cannot write there',
      detail: '~/Shared/Team/test.jpg could not be written to.',
      hint: 'Check that the path is valid and that you have permission to write to it.',
    },
    'E5 · small': {
      title: 'Cannot get that small',
      detail: 'photo.jpg is 212 KB even at the lowest quality, which is still over 50 KB.',
      hint: 'Try a larger target, or /convert to a smaller format.',
    },
  }

  it.each(Object.entries(E5))('draws %s: the tab, then the panel, cell for cell', (label, e) => {
    const expected = tinted(frame(label))
    const rows = errorPanel({ palette: DARK, ...e, width: W })
    expect(rows).toHaveLength(expected.length)
    rows.forEach((row, i) => {
      expect(describeRow(runsRow(row), expected[i] as never), `row ${i}`).toBe('equal')
    })
  })
})

describe('E5·b, the one tinted row, against the mockup', () => {
  const E5B = {
    'E5·b · missing': ['File not found', 'tset.png could not be found.'],
    'E5·b · damaged': ['Damaged PNG', 'scan.png could not be read.'],
    'E5·b · size': ['Not a size', 'fifty is not a size. Try 500kb or 2mb.'],
  } as const

  it.each(Object.entries(E5B))('draws %s cell for cell', (label, [title, reason]) => {
    const [expected, ...more] = tinted(frame(label))
    expect(more).toEqual([])
    const row = errorLine({ palette: DARK, title, reason, width: W })
    expect(describeRow(runsRow(row), expected as never)).toBe('equal')
  })
})

describe('errorPanel', () => {
  const e = {
    title: 'Cannot write there',
    detail: 'It could not be written to.',
    hint: 'Check it.',
  }

  it('wraps every line to the width less a cell of padding each side, and fills the width', () => {
    const rows = errorPanel({
      palette: DARK,
      title: 'Cannot write there',
      detail: 'The folder ~/Shared/Team could not be written to, and nothing was saved.',
      hint: 'Check that the path is valid and that you have permission to write to it.',
      width: 30,
    })
    // the tab, blank, title, 3 detail lines, 3 hint lines, blank
    expect(rows.length).toBeGreaterThan(8)
    for (const row of rows.slice(1)) expect(rowWidth(row)).toBe(30)
    const words = (from: number, to: number) =>
      rows
        .slice(from, to)
        .map((r) => text(r).trim())
        .join(' ')
    expect(words(3, rows.length - 1)).toContain('nothing was saved.')
    expect(words(3, rows.length - 1)).toContain('permission to write to it.')
    for (const row of rows.slice(2, -1)) expect(text(row).trimEnd().length).toBeLessThanOrEqual(29)
  })

  it('draws the hint in failTintDim, the grey chosen for the tint', () => {
    const rows = errorPanel({ palette: LIGHT, ...e, width: W })
    const hint = rows.at(-2)?.find((run) => run.text.includes('Check it.'))
    expect(hint?.fg).toBe(LIGHT.failTintDim)
    expect(LIGHT.failTintDim).not.toBe(LIGHT.dim)
  })

  it('leaves the hint out when there is none', () => {
    const rows = errorPanel({ palette: DARK, title: e.title, detail: e.detail, width: W })
    // the tab, blank, title, detail, blank
    expect(rows).toHaveLength(5)
  })

  it('draws without a fill when told it is plain, or when the palette has none', () => {
    for (const rows of [
      errorPanel({ palette: DARK, ...e, width: W, plain: true }),
      errorPanel({ palette: NEUTRAL, ...e, width: W }),
    ]) {
      expect(rows.flat().some((run) => run.bg)).toBe(false)
      expect(text(rows[0] as Row)).toBe('✕ failed')
      expect(rows[0]?.[0]).toMatchObject({ bold: true })
      expect(rows.slice(1).map(text)).toContain('Cannot write there')
    }
  })
})

describe('errorLine', () => {
  const title = 'Not a size'
  const reason = 'fifty is not a size. Try 500kb or 2mb.'

  it('cuts a reason that does not fit at the end, and fills the width', () => {
    const row = errorLine({ palette: DARK, title, reason, width: 30 })
    expect(rowWidth(row)).toBe(30)
    expect(text(row)).toBe(' Not a size   fifty is not a… ')
  })

  it('stays exactly the width when not even the title fits, cutting the title as a last resort', () => {
    const row = errorLine({ palette: DARK, title: 'Too many symbolic links', reason, width: 20 })
    expect(rowWidth(row)).toBe(20)
    expect(text(row)).toBe(' Too many symbolic …')
  })

  it('never cuts the title when it fits', () => {
    const row = errorLine({ palette: DARK, title, reason, width: 14 })
    expect(text(row).trimEnd()).toBe(' Not a size')
    expect(text(row)).not.toContain('…')
  })

  it('starts with a ✕ and has no fill when told it is plain, or when the palette has none', () => {
    for (const row of [
      errorLine({ palette: DARK, title, reason, width: W, plain: true }),
      errorLine({ palette: NEUTRAL, title, reason, width: W }),
    ]) {
      expect(row.some((run) => run.bg)).toBe(false)
      expect(text(row)).toBe(`✕ ${title}   ${reason}`)
      expect(stringWidth(text(row))).toBeLessThanOrEqual(W)
    }
  })
})

describe('failTint', () => {
  /** WCAG 2 contrast ratio. */
  const ratio = (a: string, b: string) => {
    const lum = (hex: string) => {
      const n = Number.parseInt(hex.slice(1), 16)
      const [r, g, bl] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
        const c = v / 255
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
      }) as [number, number, number]
      return 0.2126 * r + 0.7152 * g + 0.0722 * bl
    }
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number]
    return (hi + 0.05) / (lo + 0.05)
  }

  it('is the mockup dark red in DARK', () => {
    expect(DARK.failTint).toBe(TINT)
  })

  it('is a pale red in LIGHT on which the title red, the text and the hint grey clear AA', () => {
    for (const p of [LIGHT, DARK] satisfies Palette[]) {
      expect(ratio(p.fail, p.failTint)).toBeGreaterThanOrEqual(4.5)
      expect(ratio(p.fg, p.failTint)).toBeGreaterThanOrEqual(4.5)
      expect(ratio(p.failTintDim, p.failTint)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('has a hint grey that is DARK dim, so the mockup still matches, and plain gray in NEUTRAL', () => {
    expect(DARK.failTintDim).toBe(DARK.dim)
    expect(NEUTRAL.failTintDim).toBe('gray')
  })

  it('is no fill in NEUTRAL, which asserts no colour', () => {
    expect(NEUTRAL.failTint).toBe('')
  })
})
