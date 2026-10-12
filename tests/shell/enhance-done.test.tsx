import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import stringWidth from 'string-width'
import stripAnsi from 'strip-ansi'
import { describe, expect, it, vi } from 'vitest'
import { loadSharp } from '../../src/engines/libs.js'
import { EnhanceDone } from '../../src/shell/components/EnhanceDone.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { DARK } from '../../src/shell/theme.js'

vi.hoisted(() => {
  process.env.FORGE_INLINE_IMAGES = '0'
})

async function pair(dir: string): Promise<[string, string]> {
  const sharp = await loadSharp()
  const make = (dark: number) => {
    const data = Buffer.alloc(64 * 48 * 3, 128)
    for (let y = 8; y < 20; y++)
      for (let x = 30; x < 42; x++) data.fill(dark, (y * 64 + x) * 3, (y * 64 + x) * 3 + 3)
    return sharp(data, { raw: { width: 64, height: 48, channels: 3 } }).png()
  }
  const before = join(dir, 'sign.png')
  const after = join(dir, 'sign-sharp.png')
  await make(90).toFile(before)
  await make(10).toFile(after)
  return [before, after]
}

describe('EnhanceDone, half-block fallback', () => {
  it('draws the quiet line and the two close-ups side by side within 80 columns', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'forge-enhance-done-'))
    const [before, after] = await pair(dir)
    const { lastFrame } = render(
      <ThemeProvider palette={DARK}>
        <EnhanceDone op="boost" scale={1} before={before} after={after} savedTo={dir} width={80} />
      </ThemeProvider>,
    )
    await vi.waitFor(() => expect(lastFrame() ?? '').toContain('▀'), { timeout: 5000 })
    const lines = (lastFrame() ?? '').split('\n')
    const plain = lines.map((l) => stripAnsi(l))
    expect(plain[0]).toMatch(/✓ sign-sharp\.png {3}sharpened · same size · 64 × 48\s+in /)
    expect(plain[2]).toMatch(/^ {2} before +after\s*$/)
    const grid = plain.filter((l) => l.includes('▀'))
    expect(grid).toHaveLength(16)
    // Two pictures 36 pixels wide, the ▶ between them on the middle row.
    expect(grid.every((l) => (l.match(/▀/g) ?? []).length === 72)).toBe(true)
    expect(grid.filter((l) => l.includes('▶'))).toHaveLength(1)
    expect(plain.at(-1)).toContain('one square is one pixel')
    expect(Math.max(...plain.map((l) => stringWidth(l)))).toBeLessThanOrEqual(80)
  })
})
