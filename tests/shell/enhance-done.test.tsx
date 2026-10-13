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
    await vi.waitFor(() => expect((lastFrame() ?? '').split('\n')[4]).toContain('48;2;'), {
      timeout: 5000,
    })
    const lines = (lastFrame() ?? '').split('\n')
    const plain = lines.map((l) => stripAnsi(l))
    // The quiet line is the file and its folder: what was done is not said.
    expect(plain[0]).toMatch(/✓ sign-sharp\.png\s+in /)
    expect(plain[0]).not.toMatch(/sharpened|same size|64 × 48/)
    expect(plain[2]).toMatch(/^ {2} before +after\s*$/)
    // Each picture in a frame: its top edge under the tabs, sixteen rows of
    // picture between the sides, the bottom edge, then a gap and the note.
    expect(plain[3]).toMatch(/^ {2}┌─{34}┐ {4}┌─{34}┐\s*$/)
    const grid = plain.slice(4, -4)
    expect(grid).toHaveLength(16)
    for (const l of grid) expect(l).toMatch(/^ {2}│.{34}│.{4}│.{34}│\s*$/)
    expect(plain[20]).toMatch(/^ {2}└─{34}┘ {4}└─{34}┘\s*$/)
    // The ▶ between them on the middle row.
    const arrow = plain.filter((l) => l.includes('▶'))
    expect(arrow).toHaveLength(1)
    const row = arrow[0] ?? ''
    expect(stringWidth(row.slice(0, row.indexOf('▶')))).toBe(HOME_MARGIN + 36 + 1)
    // Before: tag and frame in one grey. After: enhance's tint behind its tag
    // and its violet for the frame and the tag's word.
    const rgb = (hex: string) =>
      [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)).join(';')
    expect(lines[2]).toContain(`48;2;${rgb(DARK.panelBand)}`)
    expect(lines[2]).toContain(`48;2;${rgb(DARK.modeEnhanceBg)}`)
    expect(lines[2]).toMatch(new RegExp(`38;2;${rgb(DARK.modeEnhance)}m(\u001b\\[1m)? after `))
    expect(lines[3]).toMatch(new RegExp(`38;2;${rgb(DARK.panelBand)}m┌`))
    expect(lines[3]).toMatch(new RegExp(`38;2;${rgb(DARK.modeEnhance)}m┌`))
    // Drawn in colour: every row has backgrounds, and the dark square shows
    // as more than one of them.
    expect(
      plain
        .slice(-2)
        .map((l) => l.trim())
        .join(' '),
    ).toBe(
      'The image preview is for illustrative purposes only; the terminal cannot display the actual image. Press  O  to see the result.',
    )
    // The key in the note is a key cap, its letter enhance's own violet.
    const note = lines.slice(-2).join('')
    expect(note).toContain(`48;2;${rgb(DARK.keycapBg)}`)
    expect(note).toMatch(new RegExp(`38;2;${rgb(DARK.modeEnhance)}m(\\u001b\\[1m)? O `))
    const pictured = lines.slice(4, -4)
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
    expect(frame).toContain('✓ sign-sharp.png')
    expect(frame).not.toContain('sharpened')
    expect(frame).not.toContain('\u001b[')
    expect(frame).not.toContain('▶')
    expect(frame).not.toContain('before')
  })

  it('fits the pictures to the rows there are, and drops them below six', () => {
    // Besides the pictures: the line, a gap, the tabs and the frame's two edges.
    expect(pictureRows(undefined)).toBe(16)
    expect(pictureRows(30)).toBe(16)
    expect(pictureRows(18)).toBe(13)
    expect(pictureRows(11)).toBe(6)
    expect(pictureRows(10)).toBe(0)
    // Drawn in characters, two rows go to the note under the pictures.
    // The note wraps to two lines at 80 columns: a gap and two rows.
    expect(noteRows(80)).toBe(3)
    expect(noteRows(200)).toBe(2)
    expect(pictureRows(18, 3)).toBe(10)
    expect(pictureRows(13, 3)).toBe(0)
  })
})
