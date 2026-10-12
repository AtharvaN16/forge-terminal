import { describe, expect, it } from 'vitest'
import { OUTSIDE, wholePercents } from '../../src/core/colour/palette.js'
import {
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
} from '../../src/shell/colour/colour-art.js'
import type { Row } from '../../src/shell/home-art.js'
import { DARK, modePalette } from '../../src/shell/theme.js'
import { describeRow, type FixtureFrame, fixtureRow, loadFixture, runsRow } from './home-cells.js'

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

function expectRows(rows: Row[], id: string, from: number) {
  rows.forEach((row, i) => {
    expect(
      describeRow(runsRow(row), fixtureRow(frame(id), from + i)),
      `${id}, row ${from + i}`,
    ).toBe('equal')
  })
}

const PAL = data.palette
const PCT = wholePercents(PAL.map((p) => p.share))
const TOP = data.grid.map((r) => [...r].map(Number))
const CORAL = 5
const SUBS = (data.subs[CORAL] ?? []).filter((x) => x.share >= 0.02)
const SUB_PCT = wholePercents(SUBS.map((x) => x.share))
const INSIDE_MAP = (data.subgrid[CORAL] ?? []).map((r) =>
  [...r].map((c) => (c === '.' ? OUTSIDE : Number(c))),
)

describe('home in colour mode (C1)', () => {
  const samples = { palette: PAL.map((p) => p.hex), scale: data.scA.map((s) => s.hex) }
  it('Palette chosen', () =>
    expectRows(choiceCards({ width: 80, palette: P, selected: 0, samples }), '1', 7))
  it('Scale chosen', () =>
    expectRows(choiceCards({ width: 80, palette: P, selected: 1, samples }), 'B1', 7))
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
    ))

  it('the photo in its own colours, the coral lit, beside the list', () => {
    const colours = PAL.map((p) => p.hex)
    const photo = photoRows({ palette: P, map: TOP, colours, lit: CORAL })
    const list = paletteColumn({
      palette: P,
      items: PAL.map((p, i) => ({ hex: p.hex, pct: PCT[i] as number })),
      selected: CORAL,
    })
    expectRows(paletteBody(photo, list), '4', 6)
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
    expectRows(paletteBody(photo, list), '5', 6)
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
    expectRows(rampRows({ palette: P, steps: data.scA, selected: 5 }), '8', 6))

  it('the preview: Aa in white and black, and the facts in plain text', () =>
    expectRows(previewRows({ palette: P, step: data.scA[5] as Step }), '8', 12))

  it('a typed colour, its ramp', () =>
    expectRows(rampRows({ palette: P, steps: data.scC, selected: 5 }), '12', 6))

  it('before there is a colour: the steps as outlines', () =>
    expectRows(emptyRampRows({ palette: P, steps: data.scA.map((s) => s.step) }), 'B2', 6))

  it('all eleven copied', () => expectRows([copiedRow(P, { count: 11 })], '11', 18))
})
