import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import { contrast } from '../../src/core/colour/contrast.js'
import { listCommands } from '../../src/shell/commands.js'
import { Home, homeKeys } from '../../src/shell/components/Home.js'
import { Prompt } from '../../src/shell/components/Prompt.js'
import {
  brandRows,
  commandRows,
  gradientAt,
  HOME_MARGIN,
  mix,
  type Row,
  surfaceRows,
  tabRows,
} from '../../src/shell/home-art.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import {
  DARK,
  dotGradient,
  LIGHT,
  MODE_ORDER,
  menuPalette,
  modeGradient,
  modePalette,
  modeWash,
  NEUTRAL,
} from '../../src/shell/theme.js'
import { ansiRow } from './home-cells.js'

vi.hoisted(() => {
  process.env.FORCE_COLOR = '3'
  process.env.NO_COLOR = ''
})

const rgb = (hex: string) => ({
  r: Number.parseInt(hex.slice(1, 3), 16),
  g: Number.parseInt(hex.slice(3, 5), 16),
  b: Number.parseInt(hex.slice(5, 7), 16),
})
const WHITE = rgb('#ffffff')
const cells = (row: Row | undefined) =>
  (row ?? []).flatMap((run) => [...run.text].map((ch) => ({ ch, fg: run.fg, bg: run.bg })))

describe('light mode (L6): the logo’s band', () => {
  it('runs vivid through dark’s hues, not between the deep text colours', () => {
    for (const mode of MODE_ORDER) {
      const stops = modeGradient(LIGHT, mode)
      expect(stops.length, mode).toBeGreaterThanOrEqual(9)
      for (const s of stops) {
        const { r, g, b } = rgb(s)
        // Chroma: a muddy, greyed stop has its channels close together.
        expect(Math.max(r, g, b) - Math.min(r, g, b), `${mode} ${s}`).toBeGreaterThanOrEqual(100)
      }
    }
    // pdf no longer ends in the brand's brown; colour is a spectrum.
    expect(modeGradient(LIGHT, 'pdf')).not.toContain(LIGHT.brand)
    expect(modeGradient(LIGHT, 'colour').length).toBeGreaterThanOrEqual(15)
  })

  it('draws every hatch cell on a near-white tint of its own colour, step for step', () => {
    for (const mode of MODE_ORDER) {
      const wash = modeWash(LIGHT, mode)
      expect(wash?.length, mode).toBe(modeGradient(LIGHT, mode).length)
      for (const w of wash ?? []) {
        const { r, g, b } = rgb(w)
        expect(Math.min(r, g, b), `${mode} ${w}`).toBeGreaterThanOrEqual(0xd0)
      }
    }
    const rows = brandRows({ width: 80, palette: LIGHT, mode: 'convert' })
    const hatch = rows.flatMap(cells).filter((c) => c.ch === '╱')
    expect(hatch.length).toBeGreaterThan(100)
    for (const c of hatch) expect(c.bg, 'a hatch cell on its wash').toMatch(/^#[0-9a-f]{6}$/)
    // FORGE itself is knocked out on the canvas.
    const letters = rows.flatMap(cells).filter((c) => c.ch === '█' || c.ch === '▀' || c.ch === '▄')
    for (const c of letters) expect(c.bg).toBeUndefined()
  })

  it('keeps dark and the plain palette as they are: no wash', () => {
    for (const p of [DARK, NEUTRAL]) {
      expect(modeWash(p, 'convert')).toBeUndefined()
      const hatch = brandRows({ width: 80, palette: p, mode: 'convert' })
        .flatMap(cells)
        .filter((c) => c.ch === '╱')
      for (const c of hatch) expect(c.bg).toBeUndefined()
    }
  })
})

describe('light mode (L6): the drop zone', () => {
  it('has dots of its own, each reading 4.5:1 on white (L1), and dark keeps the band’s', () => {
    for (const mode of MODE_ORDER) {
      for (const s of dotGradient(LIGHT, mode)) {
        expect(contrast(rgb(s), WHITE), `${mode} ${s}`).toBeGreaterThanOrEqual(4.45)
      }
      expect(dotGradient(DARK, mode)).toEqual(modeGradient(DARK, mode))
    }
  })

  it('draws the dots from those, on the plain grey fill — no wash', () => {
    const rows = surfaceRows({
      width: 80,
      rows: 8,
      palette: LIGHT,
      mode: 'pdf',
      typing: false,
      kinds: 'split',
    })
    for (const row of rows)
      for (const c of cells(row).slice(HOME_MARGIN)) expect(c.bg).toBe(LIGHT.selectionBg)
    // The top-left dot sits far enough from the middle to be at full strength.
    const W = 80 - HOME_MARGIN * 2
    const corner = cells(rows[1])[HOME_MARGIN + 3]
    expect(corner?.ch).toBe('·')
    expect(corner?.fg).toBe(
      mix(LIGHT.selectionBg, gradientAt(3 + 2, W + 14, dotGradient(LIGHT, 'pdf')), 0.9),
    )
  })

  it('sits on pure greys, as dark’s do', () => {
    for (const key of ['selectionBg', 'shelf', 'tabChip', 'panelBand', 'dim', 'border'] as const) {
      const { r, g, b } = rgb(LIGHT[key])
      expect([g, b], key).toEqual([r, r])
    }
  })
})

describe('the commands’ own colour: the brand’s gold (K1)', () => {
  it('draws "/" on its tab in the gold while the list is open', () => {
    for (const p of [DARK, LIGHT]) {
      const row = cells(tabRows({ palette: p, mode: 'convert', menu: true })[1])
      expect(row.find((c) => c.ch === '/')?.fg).toBe(p.brand)
    }
  })

  it('runs the logo’s band in gold, washed in light', () => {
    for (const p of [DARK, LIGHT]) {
      const hatch = brandRows({ width: 80, palette: p, mode: 'convert', menu: true })
        .flatMap(cells)
        .filter((c) => c.ch === '╱')
      const stops = modeGradient(p, 'menu')
      expect(stops).not.toEqual(modeGradient(p, 'convert'))
      // The first hatch cell is at the margin, on a span the width plus eight.
      expect(hatch[0]?.fg).toBe(gradientAt(HOME_MARGIN, 88, stops))
      const wash = modeWash(p, 'menu')
      expect(hatch[0]?.bg).toBe(wash ? gradientAt(HOME_MARGIN, 88, wash) : undefined)
    }
  })

  it('marks a chosen setting in gold; a chosen mode keeps its own colour', () => {
    const list = listCommands('')
    const strip = (name: string) =>
      cells(
        commandRows({
          width: 80,
          rows: 10,
          max: 14,
          palette: DARK,
          ...list,
          selected: list.items.findIndex((c) => c.name === name),
        }).find((r) => cells(r).some((c) => c.ch === '▌')),
      ).find((c) => c.ch === '▌')?.fg
    expect(strip('theme')).toBe(DARK.brand)
    expect(strip('pdf')).toBe(DARK.modePdf)
  })

  it('hands its gold to what is drawn while the list is open', () => {
    const p = menuPalette(modePalette(DARK, 'pdf'))
    expect([p.accent, p.tag, p.label]).toEqual([DARK.brand, DARK.brand, DARK.brand])
  })

  it('draws the field’s › in gold on home while a command is typed', () => {
    const list = listCommands('')
    const { lastFrame } = render(
      <ThemeProvider palette={modePalette(DARK, 'convert')}>
        <Home
          width={80}
          height={24}
          mode="convert"
          typing
          commands={{ ...list, selected: 0 }}
          field={
            <Prompt
              value="/"
              onChange={() => {}}
              onSubmit={() => {}}
              placeholder="or type a path"
              isActive
              variant="home"
              width={80}
            />
          }
          keys={homeKeys({ typing: true, completions: 0, menu: true })}
        />
      </ThemeProvider>,
    )
    const marker = (lastFrame() ?? '')
      .split('\n')
      .flatMap((l) => ansiRow(l))
      .find((c) => c.ch === '›')
    expect(marker?.fg).toBe(DARK.brand)
  })
})

describe('/extensions, a setting, in the commands’ gold', () => {
  it('opens its bar with a gold chip over the gold band', async () => {
    const { extensionsChip } = await import('../../src/shell/flows/extensions.js')
    for (const p of [DARK, LIGHT]) {
      const chip = extensionsChip(p)
      expect(chip.colour).toBe(p.brand)
      expect(chip.stops).toEqual(modeGradient(p, 'menu'))
    }
  })
})
