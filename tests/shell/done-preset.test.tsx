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
 * Done with presets (mockups/presets-2026-10.html, round 9): `p save as
 * preset` beside the formats' chip, `→ continue editing` at the bottom right
 * above the rule — both in the key row's greys. The key row is today's.
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

const lines = (preset?: { save: 'key' | 'saved' | 'update'; name?: string }) =>
  (
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
          height={24}
          preset={preset}
        />
      </ThemeProvider>,
    ).lastFrame() ?? ''
  )
    .split('\n')
    .map((l) => l.replace(SGR, ''))

describe('Done, with presets', () => {
  it('puts p save as preset beside the formats’ chip', () => {
    const chip = lines({ save: 'key' }).find((l) => l.includes('PNG → WebP')) ?? ''
    expect(chip).toMatch(/PNG → WebP {3}p {2}save as preset\s*$/)
  })

  it('puts → continue editing at the bottom right, just above the rule and the keys', () => {
    const all = lines({ save: 'key' })
    expect(all).toHaveLength(24)
    expect(all[21]?.trimEnd()).toMatch(/→ {2}continue editing$/)
    // Ends where the key row's footnote ends, a cell from the edge.
    expect(all[21]?.trimEnd().length).toBe(79)
    expect(all[22]).toMatch(/^─+$/)
    expect(all[23]).toMatch(/^ {4}↵ {2}convert another/)
  })

  it('says it was saved, where the key was', () => {
    const chip = lines({ save: 'saved', name: 'blog' }).find((l) => l.includes('PNG → WebP')) ?? ''
    expect(chip).toMatch(/PNG → WebP {3}✓ saved as blog\s*$/)
  })

  it('offers to update it once the steps change after saving', () => {
    const chip = lines({ save: 'update', name: 'blog' }).find((l) => l.includes('PNG → WebP')) ?? ''
    expect(chip).toMatch(/p {2}update blog\s*$/)
  })

  it('draws neither where presets do not apply', () => {
    const all = lines().join('\n')
    expect(all).not.toContain('save as preset')
    expect(all).not.toContain('continue editing')
  })
})
