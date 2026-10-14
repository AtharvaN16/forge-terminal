import { describe, expect, it } from 'vitest'
import { OUTSIDE, wholePercents } from '../../src/core/colour/palette.js'
import {
  COLOUR_SAMPLES,
  choiceCards,
  copiedRow,
  detailRow,
  dropZone,
  emptyRampRows,
  fieldHint,
  fieldRows,
  fieldValue,
  insideColumn,
  paletteBody,
  paletteColumn,
  photoRows,
  previewRows,
  rampRows,
  stepsLine,
} from '../../src/shell/colour/colour-art.js'
import { type Row, width } from '../../src/shell/home-art.js'
import { DARK, modePalette } from '../../src/shell/theme.js'
import {
  type Cell,
  describeHomeRow,
  describeRow,
  type FixtureFrame,
  fixtureRow,
  loadFixture,
  runsRow,
} from './home-cells.js'

/**
 * Colour mode's rows, held cell for cell to the decided flow
 * (mockups/colour-2026-10.html, ★ Flow), built from the very numbers the
 * mockup drew from (scripts/colour-mockup-fixture.mjs writes both).
 */
interface Colour {
  hex: string
  share: number
  rgb: string
  oklch: string
}
interface Step {
  step: number
  hex: string
  oklch: string
  white: number
  black: number
  seed?: boolean
}
interface Data {
  palette: Colour[]
  subs: { hex: string; share: number }[][]
  grid: string[]
  subgrid: string[][]
  scA: Step[]
  scC: Step[]
}
const FX = loadFixture('colour-mockup.json') as {
  data: Data
  frames: (FixtureFrame & { id: string })[]
}
const { data } = FX
const frame = (id: string) => FX.frames.find((f) => f.id === id) as FixtureFrame
const P = modePalette(DARK, 'colour')

/**
 * The mockup drew a photo cell of one colour as `▀` on itself; the app draws
 * it as a space on that colour, since a terminal that draws `▀` from its font
 * leaves a seam round the glyph. The two look alike: held as one.
 */
const seamless = (cells: Cell[]): Cell[] =>
  cells.map((c) =>
    c.ch === '▀' && c.fg !== null && c.fg === c.bg ? { ...c, ch: ' ', fg: null } : c,
  )
const describePhotoRow = (actual: Cell[], expected: Cell[]) =>
  describeRow(actual, seamless(expected))

function expectRows(rows: Row[], id: string, from: number, describe = describeRow) {
  rows.forEach((row, i) => {
    expect(describe(runsRow(row), fixtureRow(frame(id), from + i)), `${id}, row ${from + i}`).toBe(
      'equal',
    )
  })
}

/**
 * The cards against C1, with round 5's G4: the chosen card has no strip —
 * its lighter fill alone says it is chosen — so the mockup's `▌` is a blank
 * cell of that fill.
 */
const PAL = data.palette
const PCT = wholePercents(PAL.map((p) => p.share))
const TOP = data.grid.map((r) => [...r].map(Number))
const CORAL = 5
const SUBS = (data.subs[CORAL] ?? []).filter((x) => x.share >= 0.02)
const SUB_PCT = wholePercents(SUBS.map((x) => x.share))
const INSIDE_MAP = (data.subgrid[CORAL] ?? []).map((r) =>
  [...r].map((c) => (c === '.' ? OUTSIDE : Number(c))),
)

describe('home in colour mode: three cards (colour spec §12.6)', () => {
  const samples = {
    palette: PAL.map((p) => p.hex),
    scale: data.scA.map((s) => s.hex),
    system: COLOUR_SAMPLES.system,
  }
  const text = (row: Row) => row.map((r) => r.text).join('')
  for (const selected of [0, 1, 2] as const) {
    it(`card ${selected} chosen: names, two-line subtitles, the chosen one on the band`, () => {
      const rows = choiceCards({ width: 80, palette: P, selected, samples })
      expect(rows).toHaveLength(9)
      for (const row of rows) expect(width(row)).toBe(78)
      expect(text(rows[2] as Row)).toMatch(/Extract +Scale +Palette/)
      expect(text(rows[3] as Row)).toMatch(/extract colours +create shades +build a palette/)
      expect(text(rows[4] as Row)).toMatch(/from an image +from one colour +from one colour/)
      // The chosen card's name sits on panelBand; the others on the panel's fill.
      const names = ['Extract', 'Scale', 'Palette']
      names.forEach((name, i) => {
        const run = (rows[2] as Row).find((r) => r.text === name)
        expect(run?.bg).toBe(
          i === selected ? P.panelBand.toLowerCase() : P.selectionBg.toLowerCase(),
        )
      })
      // Each card's preview: its second sample's colour is in its row.
      const preview = rows[6] as Row
      for (const hex of [samples.palette[1], samples.scale[1], samples.system[1]]) {
        expect(preview.some((r) => r.bg === (hex as string).toLowerCase())).toBe(true)
      }
    })
  }

  it('draws every card’s swatches square: two cells across, one row down', () => {
    const all = [...samples.palette, ...samples.scale, ...samples.system].map((h) =>
      h.toLowerCase(),
    )
    for (const w of [80, 120]) {
      const preview = choiceCards({ width: w, palette: P, selected: 0, samples })[6] as Row
      const boxes = preview.filter((r) => all.includes(r.bg ?? ''))
      expect(boxes.every((r) => r.text === '  ')).toBe(true)
    }
    // At 80 columns a card fits nine: the scale keeps its middle, 100 to 900.
    const narrow = choiceCards({ width: 80, palette: P, selected: 0, samples })[6] as Row
    const has = (hex: string) => narrow.some((r) => r.bg === hex.toLowerCase())
    expect(has('#DFE6FE') && has('#252D76')).toBe(true)
    expect(has('#F4F6FF') || has('#161B58')).toBe(false)
  })
})

describe('the field, filled and neutral', () => {
  it('empty on the palette: one quiet hint', () =>
    expectRows(
      fieldRows({
        width: 80,
        palette: P,
        content: fieldHint(P, 'type an image path'),
        focus: true,
      }),
      '2',
      2,
    ))

  it('at rest on the palette: the image and its size, dim', () =>
    expectRows(
      fieldRows({
        width: 80,
        palette: P,
        content: fieldValue({ palette: P, value: 'sonoma.jpg', detail: '640×640 · 58 KB' }),
        focus: false,
      }),
      '4',
      2,
    ))

  it('at rest on the scale: the hex, its swatch, where it came from', () =>
    expectRows(
      fieldRows({
        width: 80,
        palette: P,
        content: fieldValue({
          palette: P,
          value: '#6579FD',
          swatch: true,
          detail: 'from sonoma.jpg',
        }),
        focus: false,
      }),
      '8',
      2,
    ))

  it('typing a whole hex: bright, with its swatch', () =>
    expectRows(
      fieldRows({
        width: 80,
        palette: P,
        content: fieldValue({ palette: P, value: '#E8B44C', swatch: true, typing: true }),
        focus: true,
      }),
      '12',
      2,
    ))

  it('empty on the scale', () =>
    expectRows(
      fieldRows({ width: 80, palette: P, content: fieldHint(P, 'type a hex code'), focus: true }),
      'B2',
      2,
    ))
})

describe('the palette (D1)', () => {
  it('the drop zone, with the formats it takes', () =>
    expectRows(
      dropZone({
        width: 80,
        palette: P,
        typing: false,
        formats: 'JPEG · PNG · HEIC · WebP · TIFF',
      }),
      '2',
      6,
      // The dots are round 5's brighter ones; everything else is D1's.
      describeHomeRow,
    ))

  it('the photo in its own colours, the coral lit, beside the list', () => {
    const colours = PAL.map((p) => p.hex)
    const photo = photoRows({ palette: P, map: TOP, colours, lit: CORAL })
    const list = paletteColumn({
      palette: P,
      items: PAL.map((p, i) => ({ hex: p.hex, pct: PCT[i] as number })),
      selected: CORAL,
    })
    expectRows(paletteBody(photo, list), '4', 6, describePhotoRow)
  })

  it('the chosen colour, said three ways', () =>
    expectRows(
      [
        detailRow(P, [
          { text: '#F26E69', strong: true },
          { text: 'rgb(242 110 105)' },
          { text: 'oklch(70% 0.164 24)' },
        ]),
      ],
      '4',
      19,
    ))

  it('inside the coral: only the chosen shade lit, the rest of the photo faint', () => {
    const photo = photoRows({
      palette: P,
      map: INSIDE_MAP,
      colours: SUBS.map((s) => s.hex),
      lit: 0,
      outside: { map: TOP, colours: PAL.map((p) => p.hex) },
    })
    const list = insideColumn({
      palette: P,
      parent: { hex: '#F26E69', pct: PCT[CORAL] as number },
      items: SUBS.map((s, i) => ({ hex: s.hex, pct: SUB_PCT[i] as number })),
      selected: 0,
    })
    expectRows(paletteBody(photo, list), '5', 6, describePhotoRow)
    expectRows(
      [
        detailRow(P, [
          { text: '#FD6457', strong: true },
          { text: '68% of #F26E69' },
          { text: ' · 8.0% of the image', quiet: true, joined: true },
        ]),
      ],
      '5',
      19,
    )
  })

  it('a shade copied', () => expectRows([copiedRow(P, { hex: '#DD7EA0' })], '6', 19))
})

describe('the scale (S9)', () => {
  it('the ramp, 500 from the reference, the chosen step marked', () =>
    expectRows(rampRows({ width: 80, palette: P, steps: data.scA, selected: 5 }), '8', 6))

  it('the preview: Aa in white and black, and the facts in plain text', () =>
    expectRows(previewRows({ palette: P, step: data.scA[5] as Step }), '8', 12))

  it('a typed colour, its ramp', () =>
    expectRows(rampRows({ width: 80, palette: P, steps: data.scC, selected: 5 }), '12', 6))

  it('before there is a colour: the steps as outlines', () =>
    expectRows(
      emptyRampRows({ width: 80, palette: P, steps: data.scA.map((s) => s.step) }),
      'B2',
      6,
    ))

  it('all eleven copied', () => expectRows([copiedRow(P, { count: 11 }, 'darwin')], '11', 18))
})

describe('the ramp at other widths and counts', () => {
  const text = (row: Row) => row.map((r) => r.text).join('')
  const steps = (n: number[]) =>
    n.map((step) => ({ step, hex: '#6579fd', reference: step === 500 }))
  const EVERY50 = Array.from({ length: 21 }, (_, i) => i * 50)

  it('fits the field at 76 columns, 21 steps, and always names the chosen one', () => {
    const rows = rampRows({ width: 76, palette: P, steps: steps(EVERY50), selected: 13 })
    for (const r of rows) expect(text(r).length).toBeLessThanOrEqual(74)
    expect(text(rows[0] as Row)).toContain('650')
  })

  it('an empty ramp without gaps names only the outlines it draws', () => {
    const rows = emptyRampRows({ width: 76, palette: P, steps: EVERY50 })
    const labels = text(rows[0] as Row)
    const outline = text(rows[1] as Row)
    for (const m of labels.matchAll(/\d+/g)) {
      // A number wider than its cell overhangs it: its middle is what sits over the outline.
      const middle = (m.index as number) + Math.floor(m[0].length / 2)
      expect(outline[middle], `${m[0]} at ${m.index}`).toBe('╌')
    }
  })

  it('the steps line ends at the field’s right edge, s steps at rest and ↵ done while editing', () => {
    const tw = { set: 'tailwind', start: 50, end: 950, count: 11 } as const
    const rest = text(stepsLine({ width: 76, palette: P, spec: tw }))
    expect(rest).toMatch(/^ {2}Tailwind {2}50 – 950 {2}· {2}11 steps +s +steps$/)
    expect(rest.length).toBe(74)
    const even = { set: 'even', start: 0, end: 1000, count: 15 } as const
    const editing = text(stepsLine({ width: 76, palette: P, spec: even, editing: 'count' }))
    expect(editing).toMatch(/^ +Even +from +0 +to +1000 +steps +‹ 15 › +↵ +done$/)
    expect(editing.length).toBe(74)
    const radix = { set: 'radix', start: 50, end: 950, count: 11 } as const
    expect(text(stepsLine({ width: 76, palette: P, spec: radix }))).toMatch(
      /Radix {2}1 – 12 {2}· {2}12 steps · your colour at 9 +s +steps$/,
    )
  })
})
