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
  TWEAK_WINDOW_WIDTH,
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
    expect(text(names)).toMatch(/Colour +Neutral +Alpha +Palette +tab $/)
    expect(text(rule)).toMatch(/^ {2}─{10}━{11}─+$/)
    // As wide as the field above it.
    expect(width(rule as Row)).toBe(74)
  })

  it('the steps line says the tab’s setting at rest, and makes it the last pill under s', () => {
    const rest = stepsLine({
      width: 76,
      palette: P,
      spec: DEFAULT_STEPS,
      extra: { field: 'tint', value: 'soft' },
    })
    expect(text(rest)).toMatch(/Tailwind {2}50 – 950 {2}· {2}11 steps {2}· {2}soft tint$/)
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
      /OKLab {2}straight across {2}· {2}9 steps$/,
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
    const chosen = (rows[2] as Row)
      .filter((r) => r.bold)
      .map((r) => r.text)
      .join('')
    expect(chosen).toBe(`${alphas[5]?.pct}%`)
  })

  it('the board shows through a clear step: two colours alternate in its cell', () => {
    const top = (rows[1] as Row).slice(1, 6).map((r) => r.bg)
    expect(new Set(top).size).toBe(2)
  })

  it('the preview: the 8-digit hex, the opacity, and what it is over white and over black', () => {
    const preview = alphaPreviewRows({
      palette: P,
      step: 500,
      alpha: alphas[5] as never,
      over: 'white',
    })
    expect(text(preview[0])).toMatch(/500 {2}#[0-9A-F]{8}/)
    expect(text(preview[1])).toMatch(/\d+% opaque · rgb\(\d+ \d+ \d+ \/ \d+%\)/)
    expect(text(preview[3])).toContain('over white  #6579FD')
  })
})

describe('Palette’s grid (§12.6)', () => {
  const sys = system({ r: 0xd2, g: 0x04, b: 0x2d }, 'full')
  const labels = scale(BLUE).map((x) => String(x.step))
  const gridOf = (
    sel: { row: number; col: number },
    { s = sys, lines = 28, width: w = 76, framed = true } = {},
  ) =>
    gridRows({
      width: w,
      palette: P,
      labels,
      rows: [
        ...s.rows.map((r) => ({ name: r.name, hexes: r.steps.map((x) => x.hex), yours: r.yours })),
        { name: 'neutral', hexes: s.neutral.map((x) => x.hex), yours: false },
      ],
      reference: 5,
      sel,
      framed,
      lines,
    })
  const frame = P.fg.toLowerCase()
  // 76 columns, names 10 wide: cells of four, the first at column 12.
  const at = (i: number) => 12 + i * 5

  it('the step numbers, a row per colour named down the left, the neutral last', () => {
    const rows = gridOf({ row: 5, col: 7 })
    expect(rows).toHaveLength(29)
    expect(text(rows[0])).toMatch(/50 +100 +200.*950/)
    // A gap line, then red's swatches, two lines tall, a gap line, orange's…
    expect(text(rows[2])).toMatch(/^ {2}red/)
    expect(text(rows[5])).toMatch(/^ {2}orange/)
    expect(text(rows[26])).toMatch(/^ {2}neutral/)
  })

  it('swatches are whole cells, spaces on their colour: no half blocks to leave seams', () => {
    const rows = gridOf({ row: 5, col: 7 })
    expect(rows.every((row) => row.every((r) => !/[▀▄▌▐▖▗▘▝]/.test(r.text)))).toBe(true)
    const red = rows[2] as Row
    const hex = (sys.rows[0]?.steps[0]?.hex ?? '').toLowerCase()
    expect(red.some((r) => r.text === '    ' && r.bg === hex)).toBe(true)
  })

  it('the chosen cell: a thin frame round it in the gaps, in the text colour', () => {
    const rows = gridOf({ row: 5, col: 7 })
    const cells = (i: number) => [...text(rows[i])]
    // Row 5's gap line is 1 + 5 × 3 = 16; its swatches 17–18; the gap under, 19.
    expect(
      cells(16)
        .slice(at(7) - 1, at(7) + 5)
        .join(''),
    ).toBe('╭────╮')
    expect(cells(17)[at(7) - 1]).toBe('│')
    expect(cells(18)[at(7) + 4]).toBe('│')
    expect(
      cells(19)
        .slice(at(7) - 1, at(7) + 5)
        .join(''),
    ).toBe('╰────╯')
    expect((rows[16] as Row).find((r) => r.text.includes('─'))?.fg).toBe(frame)
    // Nowhere else (row 5 is not your colour's row).
    const strokes = rows.flatMap((row) => [...text(row)]).filter((ch) => '╭╮╰╯│─'.includes(ch))
    expect(strokes).toHaveLength(2 + 4 + 2 + 2 + 2 + 4)
  })

  it('no frame while a window is open over the grid', () => {
    const rows = gridOf({ row: 5, col: 7 }, { framed: false })
    expect(rows.every((row) => !/[╭╮╰╯│─]/.test(text(row)))).toBe(true)
  })

  it('your colour’s cell is underlined in the mode’s colour, in the gap under it', () => {
    const yours = sys.rows.findIndex((r) => r.yours)
    const accent = P.accent.toLowerCase()
    const rows = gridOf({ row: 0, col: 0 })
    // Its swatches on lines 2 + 3 × row and the next; the gap under them after.
    const under = rows[4 + yours * 3] as Row
    expect([...text(under)].slice(at(5), at(5) + 4).join('')).toBe('━━━━')
    expect(under.find((r) => r.text.includes('━'))?.fg).toBe(accent)
    expect(rows.every((row) => !text(row).includes('◤'))).toBe(true)
    // Chosen, the underline takes the middle of the frame's bottom edge.
    const chosen = gridOf({ row: yours, col: 5 })
    expect([...text(chosen[4 + yours * 3])].slice(at(5) - 1, at(5) + 5).join('')).toBe('╰━━━━╯')
  })

  it('fewer colours: every row shows, up to three lines tall', () => {
    const opposite = system({ r: 0xd2, g: 0x04, b: 0x2d }, 'opposite')
    const rows = gridOf({ row: 0, col: 0 }, { s: opposite, lines: 40 })
    const tall = rows.filter((row) => text(row).includes('    ') && row.some((r) => r.bg)).length
    expect(tall).toBe((opposite.rows.length + 1) * 3)
  })

  it('rows that only fit on a line each, touching: every one shows, and none scrolls (2026-10-24)', () => {
    const rows = gridOf({ row: 8, col: 10 }, { lines: 13 })
    expect(rows).toHaveLength(14)
    expect(text(rows[1])).toMatch(/^ {2}red/)
    expect(text(rows[9])).toMatch(/^ {2}neutral/)
    expect(rows.every((r) => !/[┃│]/.test(text(r)))).toBe(true)
    // The chosen cell, marked in the gaps either side.
    expect([...text(rows[9])][at(10) - 1]).toBe('▕')
  })

  it('fewer lines than rows: one-line swatches with gaps, scrolling, the chosen row kept in the middle', () => {
    const rows = gridOf({ row: 8, col: 10 }, { lines: 7 })
    expect(rows).toHaveLength(8)
    // The last three: purple, pink, neutral.
    expect(text(rows[2])).toMatch(/^ {2}purple/)
    expect(text(rows[6])).toMatch(/^ {2}neutral/)
    const bar = rows.slice(1).map((r) => [...text(r)].at(-1))
    expect(bar.every((ch) => ch === '│' || ch === '┃')).toBe(true)
    // At the end of the list, so the thumb is at the bottom.
    expect(bar.at(-1)).toBe('┃')
    expect(bar[0]).toBe('│')
    expect(gridOf({ row: 0, col: 0 }).every((r) => !text(r).includes('┃'))).toBe(true)
  })

  it('cells grow with the window, up to eight wide, never past it', () => {
    for (const w of [76, 100, 160]) {
      const rows = gridOf({ row: 5, col: 7 }, { width: w })
      for (const row of rows) expect(width(row)).toBeLessThan(w)
    }
    const wide = gridOf({ row: 0, col: 0 }, { width: 160 })[2] as Row
    expect(wide.some((r) => r.text === ' '.repeat(8) && r.bg)).toBe(true)
  })

  it('before a colour: faint numbers and outlines', () => {
    const rows = emptyGridRows({ width: 76, palette: P, labels: ['50', '500', '950'], lines: 4 })
    expect(text(rows[1])).toContain('╌╌╌╌')
  })
})

describe('Palette’s windows (W1)', () => {
  const under: Row[] = Array.from({ length: 14 }, () => [{ text: 'x'.repeat(76), fg: P.fg }])

  it('a framed window over the screen, the title in its top edge; the screen behind fades', () => {
    const lines = modeLines(
      P,
      [
        { name: 'Full set', hexes: ['#ff0000', '#00ff00'] },
        { name: 'Pastel', hexes: ['#ffcccc'] },
      ],
      1,
      0,
      2,
    )
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

  it('fits a scale’s eleven chips, or an even set’s 21, inside the window', () => {
    const slider = [{ label: 'brightness', value: 0, max: 100, unit: '' }]
    for (const n of [9, 11, 21]) {
      const hexes = Array.from({ length: n }, () => '#808080')
      const strip = tweakLines(P, slider, 0, hexes).at(-1) as Row
      expect(strip.filter((r) => r.bg)).toHaveLength(n)
      expect(width(strip), `${n} chips`).toBeLessThanOrEqual(TWEAK_WINDOW_WIDTH - 2)
    }
  })
})
