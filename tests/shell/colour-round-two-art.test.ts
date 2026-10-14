import { describe, expect, it } from 'vitest'
import { alphaOf, WHITE } from '../../src/core/colour/alpha.js'
import { DEFAULT_STEPS, scale } from '../../src/core/colour/scale.js'
import { system } from '../../src/core/colour/system.js'
import {
  alphaPreviewRows,
  alphaRampRows,
  mixLine,
  scaleTabRows,
  stepsLine,
} from '../../src/shell/colour/colour-art.js'
import {
  emptyGridRows,
  gridRows,
  modeLines,
  tweakLines,
  windowOver,
} from '../../src/shell/colour/system-art.js'
import { type Row, width } from '../../src/shell/home-art.js'
import { DARK, modePalette } from '../../src/shell/theme.js'

/** The rows of colour, round two (colour spec §12), as mockups/colour-more-2026-10.html draws them. */

const P = modePalette(DARK, 'colour')
const text = (row: Row | undefined) => (row ?? []).map((r) => r.text).join('')
const BLUE = { r: 0x65, g: 0x79, b: 0xfd }
const steps = scale(BLUE)

describe('Scale’s tabs and lines', () => {
  it('the tabs as /about’s: names, then a rule heavy under the one in use', () => {
    const [names, rule] = scaleTabRows({ width: 76, palette: P, at: 1 })
    expect(text(names)).toMatch(/Colour +Neutral +Alpha +tab +switch/)
    expect(text(rule)).toMatch(/^ {2}─{10}━{11}─+$/)
    // As wide as the field above it.
    expect(width(rule as Row)).toBe(74)
  })

  it('the steps line says the tab’s setting at rest, and makes it the last pill under s', () => {
    const rest = stepsLine({ width: 76, palette: P, spec: DEFAULT_STEPS, extra: { field: 'tint', value: 'soft' } })
    expect(text(rest)).toMatch(/Tailwind {2}50 – 950 {2}· {2}11 steps {2}· {2}soft tint +s +steps/)
    const editing = stepsLine({
      width: 76,
      palette: P,
      spec: DEFAULT_STEPS,
      editing: 'over',
      extra: { field: 'over', value: 'black' },
    })
    expect(text(editing)).toMatch(/over +‹ black ›.*↵ +done/)
  })

  it('the mix’s line: the way across and the count; under s, both as pills', () => {
    expect(text(mixLine({ width: 76, palette: P, space: 'oklab', count: 9 }))).toMatch(
      /OKLab {2}straight across {2}· {2}9 steps +s +steps/,
    )
    expect(
      text(mixLine({ width: 76, palette: P, space: 'oklch', count: 9, editing: 'way' })),
    ).toMatch(/‹ OKLCH ›\s+steps\s+9\s.*↵ +done/)
  })
})

describe('the Alpha tab (A1, P1)', () => {
  const alphas = steps.map((s) => alphaOf(s.rgb, WHITE))
  const rows = alphaRampRows({ width: 76, palette: P, steps, alphas, selected: 5, over: 'white' })

  it('labels, three lines of checkerboard, the marker', () => {
    expect(rows).toHaveLength(5)
    expect(text(rows[0])).toContain('500')
    expect(text(rows[4])).toContain('▔▔▔▔▔')
  })

  it('each step’s opacity on the middle line; the chosen one bold', () => {
    expect(text(rows[2])).toMatch(/4% +13%.*91%/)
    const chosen = (rows[2] as Row).filter((r) => r.bold).map((r) => r.text).join('')
    expect(chosen).toBe(`${alphas[5]?.pct}%`)
  })

  it('the board shows through a clear step: two colours alternate in its cell', () => {
    const top = (rows[1] as Row).slice(1, 6).map((r) => r.bg)
    expect(new Set(top).size).toBe(2)
  })

  it('the preview: the 8-digit hex, the opacity, and what it is over white and over black', () => {
    const preview = alphaPreviewRows({ palette: P, step: 500, alpha: alphas[5] as never, over: 'white' })
    expect(text(preview[0])).toMatch(/500 {2}#[0-9A-F]{8}/)
    expect(text(preview[1])).toMatch(/\d+% opaque · rgb\(\d+ \d+ \d+ \/ \d+%\)/)
    expect(text(preview[3])).toContain('over white  #6579FD')
  })
})

describe('Palette’s grid (§12.6)', () => {
  const sys = system({ r: 0xd2, g: 0x04, b: 0x2d }, 'full')
  const gridOf = (sel: { row: number; col: number }, s = sys) =>
    gridRows({
      width: 76,
      palette: P,
      labels: DEFAULT_STEPS.set === 'tailwind' ? scale(BLUE).map((x) => String(x.step)) : [],
      rows: [
        ...s.rows.map((r) => ({ name: r.name, hexes: r.steps.map((x) => x.hex), yours: r.yours })),
        { name: 'neutral', hexes: s.neutral.map((x) => x.hex), yours: false },
      ],
      reference: 5,
      sel,
      lines: 9,
    })

  it('the step numbers, a row per colour named down the left, the neutral last', () => {
    const rows = gridOf({ row: 5, col: 7 })
    expect(rows).toHaveLength(10)
    expect(text(rows[0])).toMatch(/50 +100 +200.*950/)
    expect(text(rows[1])).toMatch(/^ {2}red/)
    expect(text(rows[9])).toMatch(/^ {2}neutral/)
  })

  it('a gap between rows: swatches fill only the lower half of a one-line row', () => {
    const row = gridOf({ row: 5, col: 7 })[2] as Row
    const swatches = row.filter((r) => r.text.includes('▄'))
    expect(swatches.length).toBeGreaterThan(0)
    expect(swatches.every((r) => r.bg === P.canvas.toLowerCase())).toBe(true)
  })

  it('the chosen cell: wider, with a stroke round it in the text colour', () => {
    const rows = gridOf({ row: 5, col: 7 })
    const frame = P.fg.toLowerCase()
    const chosen = rows[6] as Row
    // Half stroke, half cell, in the gap columns either side.
    expect(chosen.some((r) => r.text.startsWith('▗') && r.bg === frame)).toBe(true)
    expect(chosen.some((r) => r.text.includes('▖') && r.bg === frame)).toBe(true)
    // The stroke's bottom: the half line above the next row.
    expect((rows[7] as Row).some((r) => r.text.includes('▀') && r.fg === frame)).toBe(true)
  })

  it('your colour’s cell is marked: ▖ on one-line rows, ◤ where rows are taller', () => {
    const one = gridOf({ row: 5, col: 7 })[1] as Row
    expect(one.some((r) => r.text === '▖')).toBe(true)
    const opposite = system({ r: 0xd2, g: 0x04, b: 0x2d }, 'opposite')
    const tall = gridOf({ row: 2, col: 0 }, opposite)
    expect(tall.some((row) => row.some((r) => r.text === '◤'))).toBe(true)
  })

  it('the chosen cell on the last row: the stroke’s bottom takes a line of its own', () => {
    expect(gridOf({ row: 8, col: 10 })).toHaveLength(11)
  })

  it('before a colour: faint numbers and outlines', () => {
    const rows = emptyGridRows({ width: 76, palette: P, labels: ['50', '500', '950'], lines: 4 })
    expect(text(rows[1])).toContain('╌╌╌╌')
  })
})

describe('Palette’s windows (W1)', () => {
  const under: Row[] = Array.from({ length: 14 }, () => [{ text: 'x'.repeat(76), fg: P.fg }])

  it('a framed window over the screen, the title in its top edge; the screen behind fades', () => {
    const lines = modeLines(P, [
      { name: 'Full set', hexes: ['#ff0000', '#00ff00'] },
      { name: 'Pastel', hexes: ['#ffcccc'] },
    ], 1, 0, 2)
    const rows = windowOver(P, under, { title: 'Mode', lines, width: 56, columns: 76, top: 2 })
    expect(text(rows[2])).toContain('╭─ Mode ─')
    expect(text(rows[2 + lines.length + 1])).toContain('╰──')
    expect(text(rows[5])).toMatch(/│ › Pastel/)
    // Outside the window, the screen is faded towards the canvas.
    expect((rows[0] as Row)[0]?.fg).not.toBe(P.fg.toLowerCase())
  })

  it('a list longer than the window: ↓ n more, and a bar in the right edge', () => {
    const modes = Array.from({ length: 7 }, (_, i) => ({ name: `Mode ${i}`, hexes: ['#000000'] }))
    const lines = modeLines(P, modes, 3, 1, 4)
    expect(text(lines.at(-1))).toContain('↓ 2 more')
    const rows = windowOver(P, under, {
      title: 'Mode',
      lines,
      width: 56,
      columns: 76,
      top: 1,
      scroll: { at: 1, of: 7 },
    })
    expect(rows.some((row) => text(row).includes('┃'))).toBe(true)
  })

  it('the Tweak window: four sliders, the value on the pill, hue in degrees, then the strip', () => {
    const lines = tweakLines(
      P,
      [
        { label: 'brightness', value: 20, max: 100, unit: '' },
        { label: 'saturation', value: -35, max: 100, unit: '' },
        { label: 'hue', value: 0, max: 180, unit: '°' },
        { label: 'contrast', value: 0, max: 100, unit: '' },
      ],
      1,
      ['#ff0000', '#00ff00'],
    )
    const all = lines.map(text).join('\n')
    expect(all).toContain('+20')
    expect(all).toContain('−35')
    expect(all).toContain('0°')
    expect((lines.at(-1) as Row).filter((r) => r.bg).length).toBe(2)
  })
})
