import { homedir } from 'node:os'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import type { Result, SourceInfo } from '../../src/core/types.js'
import { DoneScreen } from '../../src/shell/components/Done.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { DARK, modePalette } from '../../src/shell/theme.js'

vi.hoisted(() => {
  process.env.FORCE_COLOR = '3'
  process.env.NO_COLOR = ''
})

/**
 * Done with presets (round 24, mockups/done-2026-10-round18.html, K26):
 * `p save as preset` quiet at the bottom left; `→ continue editing` on a small
 * frame in the shelf grey at the bottom right, half a row above and below it,
 * ending on the block's edge. The key row is today's.
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

const frame = (preset?: { save: 'key' | 'saved' | 'update'; name?: string }, height = 24) =>
  render(
    <ThemeProvider palette={modePalette(DARK, 'convert')}>
      <DoneScreen
        mode="convert"
        trail={{ answers: ['WebP', '80', 'Desktop', 'photo.webp'], current: 'Done' }}
        result={result}
        offers={[]}
        again="convert another"
        reveal="Show in Finder"
        width={80}
        height={height}
        preset={preset}
      />
    </ThemeProvider>,
  ).lastFrame() ?? ''
const lines = (preset?: { save: 'key' | 'saved' | 'update'; name?: string }, height = 24) =>
  frame(preset, height)
    .split('\n')
    .map((l) => l.replace(SGR, ''))
/** The truecolor SGR that sets `hex` as the fill (48) or the ink (38). */
const sgr = (layer: 38 | 48, hex: string) =>
  `${layer};2;${[1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)).join(';')}m`

describe('Done, with presets', () => {
  it('leaves the strip to the formats and the change', () => {
    const strip = lines({ save: 'key' }).find((l) => l.includes('PNG → WebP')) ?? ''
    expect(strip).not.toContain('preset')
  })

  it('puts p save as preset at the bottom left and → continue editing at the bottom right', () => {
    const all = lines({ save: 'key' })
    expect(all).toHaveLength(24)
    expect(all[20]?.trimEnd()).toMatch(/^ {2}p save as preset +continue editing →$/)
    // → ends on the block's edge, two cells from the window's.
    expect(all[20]?.trimEnd().length).toBe(78)
    // One row: nothing above it, and never ▄ ▀ (seams in Apple Terminal).
    expect(all[19]?.trim()).toBe('')
    // A blank row between it and the rule.
    expect(all[21]?.trim()).toBe('')
    expect(all.join('')).not.toMatch(/[▄▀]/)
    // The rule sits on the app's margins (2026-10-20): two columns in, two short.
    expect(all[22]).toBe(`  ${'─'.repeat(76)}`)
    expect(all[23]).toMatch(/^ {3}↵ {2}convert another/)
  })

  it('draws continue editing → as quiet as p: the words in the border grey, → dim, no fill', () => {
    const row = frame({ save: 'key' }).split('\n')[20] ?? ''
    expect(row).toMatch(new RegExp(`${sgr(38, DARK.dim)}p`))
    expect(row).toMatch(new RegExp(`${sgr(38, DARK.border)} save as preset`))
    expect(row).toMatch(new RegExp(`${sgr(38, DARK.border)}continue editing `))
    expect(row).toMatch(new RegExp(`${sgr(38, DARK.dim)}→`))
    expect(row).not.toContain('48;2;')
  })

  it('says it was saved, where p was', () => {
    expect(lines({ save: 'saved', name: 'blog' })[20]).toMatch(/^ {2}✓ saved as blog +/)
  })

  it('offers to update it once the steps change after saving', () => {
    expect(lines({ save: 'update', name: 'blog' })[20]).toMatch(/^ {2}p update blog +/)
  })

  it('steps the body back on a short screen, so the foot and its blank row still fit', () => {
    const all = lines({ save: 'key' }, 17)
    expect(all).toHaveLength(17)
    expect(all[13]?.trimEnd()).toMatch(/p save as preset +continue editing →$/)
    expect(all[14]?.trim()).toBe('')
  })

  it('draws neither where presets do not apply', () => {
    const all = lines().join('\n')
    expect(all).not.toContain('save as preset')
    expect(all).not.toContain('continue editing')
  })
})
