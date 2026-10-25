import { describe, expect, it } from 'vitest'
import { DEFAULT_STEPS, scale, stepsOf } from '../../src/core/colour/scale.js'
import { system } from '../../src/core/colour/system.js'
import {
  copiedMessage,
  mixLine,
  moreHintRow,
  newColourHint,
  scaleTabRows,
  stepsLine,
} from '../../src/shell/colour/colour-art.js'
import {
  GRADIENT_WINDOW_WIDTH,
  gradientLines,
  gridRows,
  MORE_WINDOW_WIDTH,
  modeRow,
  moreLines,
} from '../../src/shell/colour/system-art.js'
import { type Row, width } from '../../src/shell/home-art.js'
import { DARK, modePalette } from '../../src/shell/theme.js'

/**
 * Colour mode, simpler (2026-10-24): the rows the redesign adds or changes,
 * as mockups/colour-redesign-2026-10-round5.html and
 * colour-more-copy-2026-10-round6.html (P1) draw them.
 */

const P = modePalette(DARK, 'colour')
const text = (row: Row | undefined) => (row ?? []).map((r) => r.text).join('')
const BLUE = { r: 0x65, g: 0x79, b: 0xfd }
const AMBER = { r: 0xf5, g: 0xa5, b: 0x24 }

describe('the tab row and the lines under the view', () => {
  it('four tabs, Palette last; the tab cap alone at the far end', () => {
    const [names, rule] = scaleTabRows({ width: 76, palette: P, at: 3 })
    expect(text(names)).toMatch(/Colour +Neutral +Alpha +Palette +tab $/)
    expect(text(names)).not.toContain('switch')
    expect(text(rule)).toMatch(/^ {2}─{30}━{11}─+$/)
    expect(width(rule as Row)).toBe(74)
  })

  it('the steps line, the gradient’s line and the mode’s line say no keys: More has them', () => {
    const steps = stepsLine({ width: 76, palette: P, spec: DEFAULT_STEPS })
    expect(text(steps)).toMatch(/Tailwind +50 – 950 +· +11 steps *$/)
    expect(text(mixLine({ width: 76, palette: P, space: 'oklab', count: 9 }))).toMatch(
      /OKLab +straight across +· +9 steps *$/,
    )
    expect(text(modeRow(P, 76, 'Full set'))).toBe('  Full set')
  })

  it('More over the rule at the right, as home’s “/ menu”: the key on a grey cap, in pink', () => {
    const row = moreHintRow({ palette: P, width: 76 })
    expect(text(row)).toMatch(/ m {2}more {2}$/)
    expect(width(row)).toBe(76)
    const cap = row.find((r) => r.text === ' m ')
    expect(cap).toMatchObject({ bg: P.keycapBg, fg: P.accent })
    expect(row.find((r) => r.text === ' more')).toMatchObject({ fg: P.dim })
  })

  it('# new colour at the field’s far end, plain: the key bright, the words quiet', () => {
    const row = newColourHint(P)
    expect(text(row)).toBe('# new colour')
    expect(row[0]).toMatchObject({ text: '#', fg: P.fg })
  })
})

describe('what a copy says, on the key row', () => {
  it('a colour: just what was copied', () => {
    expect(text(copiedMessage(P, 'copied #6579FD'))).toBe('✓ copied #6579FD')
    expect(text(copiedMessage(P, 'copied #0021FC9A'))).toBe('✓ copied #0021FC9A')
  })

  it('a set: where it pastes, as today', () => {
    const mac = 'darwin' as NodeJS.Platform
    expect(text(copiedMessage(P, 'copied 11 swatches', mac))).toBe(
      '✓ copied 11 swatches · paste into Figma with ⌘V',
    )
    expect(text(copiedMessage(P, 'copied 9 rows of swatches', mac))).toBe(
      '✓ copied 9 rows of swatches · paste into Figma with ⌘V',
    )
  })
})

describe('the windows More opens', () => {
  it('More: its items, the one in hand on the band with ❯, each with its key at the right', () => {
    const lines = moreLines(P, ['gradient', 'tweak', 'steps'], 1)
    const shown = lines.map(text).filter((t) => t.trim() !== '')
    expect(shown).toHaveLength(3)
    expect(shown[0]).toMatch(/^ {3}Gradient +⇧→ +$/)
    expect(shown[1]).toMatch(/^ ❯ Tweak +t +$/)
    expect(shown[2]).toMatch(/^ {3}Steps +s +$/)
    for (const l of lines) expect(width(l)).toBeLessThanOrEqual(MORE_WINDOW_WIDTH - 2)
  })

  it('Gradient: each colour numbered with its swatch, the box last, the gradient under them', () => {
    const lines = gradientLines(P, { stops: [BLUE, AMBER], at: 2, text: '#2EC4B6' })
    const t = lines.map(text)
    expect(t.some((l) => /^ +1 +#6579FD/.test(l))).toBe(true)
    expect(t.some((l) => /^ +2 +#F5A524/.test(l))).toBe(true)
    expect(t.some((l) => /3 +❯ #2EC4B6/.test(l))).toBe(true)
    const strip = lines.find((l) => l.filter((r) => r.bg).length > 10)
    expect(strip?.[1]?.bg?.toLowerCase()).toBe('#6579fd')
    for (const l of lines) expect(width(l)).toBeLessThanOrEqual(GRADIENT_WINDOW_WIDTH - 2)
  })

  it('Gradient: what is no colour is said in the box', () => {
    const lines = gradientLines(P, { stops: [BLUE], at: 1, text: 'blorpx', wrong: true })
    expect(lines.map(text).join('\n')).toMatch(/blorpx +wrong input/)
  })
})

describe('the Palette tab’s grid', () => {
  it('when its rows only fit on one line each, every row shows, touching, and none scrolls', () => {
    const sys = system(BLUE, 'full')
    const rows = [
      ...sys.rows.map((r) => ({ name: r.name, hexes: r.steps.map((x) => x.hex), yours: r.yours })),
      { name: 'neutral', hexes: sys.neutral.map((x) => x.hex), yours: false },
    ]
    const out = gridRows({
      width: 76,
      palette: P,
      labels: stepsOf(DEFAULT_STEPS).map(String),
      rows,
      reference: 5,
      sel: { row: 5, col: 5 },
      lines: 10,
    })
    // The step numbers, then the nine rows, and nothing scrolls.
    const names = out.slice(1, 10).map((r) => text(r).trim().split(/\s+/)[0])
    expect(names).toEqual(rows.map((r) => r.name))
    expect(out.map(text).join('')).not.toMatch(/[┃│]/)
    // The chosen cell is marked in the gaps either side of it (here your colour, with its dot).
    expect(text(out[6])).toMatch(/▕[ •]{4,8}▏/)
    expect(scale(BLUE)).toHaveLength(11)
  })
})
