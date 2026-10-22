import { homedir } from 'node:os'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import type { Result, SourceInfo } from '../../src/core/types.js'
import { DoneScreen, doneActions } from '../../src/shell/components/Done.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { DARK, modePalette } from '../../src/shell/theme.js'

vi.hoisted(() => {
  process.env.FORCE_COLOR = '3'
  process.env.NO_COLOR = ''
})

/**
 * Done's way on (mockups/done-next-2026-10-round9.html, Y31): a three-row
 * frame in the shelf grey holding Open, Finder, Save as preset and Continue
 * editing, flush on its left edge, then a cell of canvas and Home as its own
 * block in the mode's tint at the block's right edge. Home is selected as
 * the screen opens, so it is the bright mode colour. Under the rule, ←→
 * choose and ↵ confirm.
 */
const SGR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')
const DESKTOP = join(homedir(), 'Desktop')

const result: Result = {
  job: {
    op: 'convert',
    sources: [
      {
        kind: 'image',
        path: join(DESKTOP, 'photo.png'),
        format: 'png',
        bytes: 14_400_000,
        width: 3024,
        height: 2016,
        hasAlpha: false,
        frames: 1,
      } as SourceInfo,
    ],
    outputs: [join(DESKTOP, 'photo.webp')],
    target: 'webp',
    options: { background: '#ffffff', keepMetadata: false },
  },
  outputBytes: 2_000_000,
  warnings: [],
}

const frame = (
  preset?: { save: 'key' | 'saved' | 'update'; name?: string },
  height = 24,
  { width = 80, selected }: { width?: number; selected?: number } = {},
) =>
  render(
    <ThemeProvider palette={modePalette(DARK, 'convert')}>
      <DoneScreen
        mode="convert"
        trail={{ answers: ['WebP', '80', 'Desktop', 'photo.webp'], current: 'Done' }}
        result={result}
        offers={[]}
        actions={doneActions({ preset, reveal: 'Show in Finder' })}
        selected={selected}
        width={width}
        height={height}
      />
    </ThemeProvider>,
  ).lastFrame() ?? ''
const lines = (
  preset?: { save: 'key' | 'saved' | 'update'; name?: string },
  height = 24,
  opts: { width?: number; selected?: number } = {},
) =>
  frame(preset, height, opts)
    .split('\n')
    .map((l) => l.replace(SGR, ''))
/** The truecolor SGR that sets `hex` as the fill (48) or the ink (38). */
const sgr = (layer: 38 | 48, hex: string) =>
  `${layer};2;${[1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)).join(';')}m`

describe('Done, its way on', () => {
  it('leaves the strip to the formats and the change', () => {
    const strip = lines({ save: 'key' }).find((l) => l.includes('PNG → WebP')) ?? ''
    expect(strip).not.toContain('preset')
  })

  it('draws every action and Home in three rows over a blank row and the rule', () => {
    const all = lines({ save: 'key' })
    expect(all).toHaveLength(24)
    expect(all[19]).toMatch(
      /^ {3}o Open +f Finder +p Save as preset +e Continue editing +↵ Home {2}$/,
    )
    // Home ends on the block's edge, two cells from the window's.
    expect(all[19]?.length).toBe(78)
    expect(all[21]?.trim()).toBe('')
    expect(all[22]).toBe(`  ${'─'.repeat(76)}`)
    expect(all.join('')).not.toMatch(/[▄▀]/)
  })

  it('puts ←→ choose and ↵ confirm on the key row', () => {
    expect(lines({ save: 'key' })[23]).toMatch(/^ {3}←→ {2}choose {3}↵ {2}confirm +ctrl-c quit$/)
  })

  it('opens with Home selected: the bright mode colour', () => {
    const row = frame({ save: 'key' }).split('\n')[19] ?? ''
    expect(row).toContain(sgr(48, DARK.modeConvert))
  })

  it('lights a selected action in the key caps’ grey', () => {
    const row = frame({ save: 'key' }, 24, { selected: 0 }).split('\n')[19] ?? ''
    expect(row).toContain(sgr(48, DARK.keycapBg))
    expect(row).not.toContain(sgr(48, DARK.modeConvert))
  })

  it('says a preset was saved, in green, on its button', () => {
    expect(lines({ save: 'saved', name: 'blog' })[19]).toContain('p Preset saved')
  })

  it('offers to update it once the steps change after saving', () => {
    expect(lines({ save: 'update', name: 'blog' })[19]).toContain('p Update preset')
  })

  it('steps the body back on a short screen, so the actions and their blank row still fit', () => {
    const all = lines({ save: 'key' }, 17)
    expect(all).toHaveLength(17)
    expect(all[12]).toMatch(/o Open .* ↵ Home {2}$/)
    expect(all[14]?.trim()).toBe('')
  })

  it('keeps Open, Finder and Home where presets do not apply', () => {
    const all = lines()
    expect(all[19]).toMatch(/^ {3}o Open +f Finder +↵ Home {2}$/)
    expect(all.join('\n')).not.toContain('preset')
  })

  it('says the actions on the key row where the window is too narrow for them', () => {
    const all = lines({ save: 'key' }, 24, { width: 60 })
    expect(all.join('\n')).not.toContain('↵ Home')
    expect(all[23]).toMatch(/^ {3}↵ {2}home {3}o {2}open {3}f {2}finder/)
  })
})
