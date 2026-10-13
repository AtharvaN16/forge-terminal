import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import chalk from 'chalk'
import { render } from 'ink-testing-library'
import stringWidth from 'string-width'
import stripAnsi from 'strip-ansi'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadSharp } from '../../src/engines/libs.js'
import { EnhanceDone, noteRows, pictureRows } from '../../src/shell/components/EnhanceDone.js'
import { HOME_MARGIN } from '../../src/shell/home-art.js'
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

const level = chalk.level
afterEach(() => {
  chalk.level = level
})

describe('EnhanceDone, half-block fallback', () => {
  it('draws the quiet line and the two close-ups side by side within 80 columns', async () => {
    chalk.level = 3 // a true-colour terminal (the suite's stdout is not a TTY)
    const dir = await mkdtemp(join(tmpdir(), 'forge-enhance-done-'))
    const [before, after] = await pair(dir)
    const { lastFrame } = render(
      <ThemeProvider palette={DARK}>
        <EnhanceDone op="boost" scale={1} before={before} after={after} savedTo={dir} width={80} />
      </ThemeProvider>,
    )
    await vi.waitFor(() => expect((lastFrame() ?? '').split('\n')[3]).toContain('48;2;'), {
      timeout: 5000,
    })
    const lines = (lastFrame() ?? '').split('\n')
    const plain = lines.map((l) => stripAnsi(l))
    expect(plain[0]).toMatch(/✓ sign-sharp\.png {3}sharpened · same size · 64 × 48\s+in /)
    expect(plain[2]).toMatch(/^ {2} before +after\s*$/)
    // Sixteen rows of picture under the tabs, then a gap and the one note
    // that says the picture is drawn in characters.
    const grid = plain.slice(3, -3)
    expect(grid).toHaveLength(16)
    // Two pictures 36 cells wide, the ▶ between them on the middle row.
    const arrow = grid.filter((l) => l.includes('▶'))
    expect(arrow).toHaveLength(1)
    const row = arrow[0] ?? ''
    expect(stringWidth(row.slice(0, row.indexOf('▶')))).toBe(HOME_MARGIN + 36 + 1)
    // Drawn in colour: every row has backgrounds, and the dark square shows
    // as more than one of them.
    expect(
      plain
        .slice(-2)
        .map((l) => l.trim())
        .join(' '),
    ).toBe(
      'The image preview is for illustrative purposes only; the terminal cannot display the actual image. Press O to see the result.',
    )
    // The key in the note is enhance's own violet, as a key on its screen.
    const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(DARK.modeEnhance.slice(i, i + 2), 16))
    expect(lines.slice(-2).join('')).toMatch(new RegExp(`38;2;${r};${g};${b}m(\\u001b\\[1m)?O`))
    const pictured = lines.slice(3, -3)
    expect(pictured.every((l) => l.includes('\u001b[48;2;'))).toBe(true)
    expect(new Set(pictured.join('').match(/48;2;\d+;\d+;\d+/g)).size).toBeGreaterThan(1)
    expect(Math.max(...plain.map((l) => stringWidth(l)))).toBeLessThanOrEqual(80)
  })

  it('with no colour (NO_COLOR, mapped to colour level 0) writes no SGR and only the quiet line', async () => {
    chalk.level = 0
    const dir = await mkdtemp(join(tmpdir(), 'forge-enhance-done-'))
    const [before, after] = await pair(dir)
    const { lastFrame } = render(
      <ThemeProvider palette={DARK}>
        <EnhanceDone op="boost" scale={1} before={before} after={after} savedTo={dir} width={80} />
      </ThemeProvider>,
    )
    await new Promise((r) => setTimeout(r, 300))
    const frame = lastFrame() ?? ''
    expect(frame).toContain('✓ sign-sharp.png   sharpened')
    expect(frame).not.toContain('\u001b[')
    expect(frame).not.toContain('▶')
    expect(frame).not.toContain('before')
  })

  it('fits the pictures to the rows there are, and drops them below six', () => {
    expect(pictureRows(undefined)).toBe(16)
    expect(pictureRows(30)).toBe(16)
    expect(pictureRows(18)).toBe(15)
    expect(pictureRows(9)).toBe(6)
    expect(pictureRows(8)).toBe(0)
    // Drawn in characters, two rows go to the note under the pictures.
    // The note wraps to two lines at 80 columns: a gap and two rows.
    expect(noteRows(80)).toBe(3)
    expect(noteRows(200)).toBe(2)
    expect(pictureRows(18, 3)).toBe(12)
    expect(pictureRows(11, 3)).toBe(0)
  })
})
