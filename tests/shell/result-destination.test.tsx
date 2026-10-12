import { homedir } from 'node:os'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import type { Result, SourceInfo } from '../../src/core/types.js'
import { HistoryEntry } from '../../src/shell/blocks.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { DARK } from '../../src/shell/theme.js'

/**
 * Audit #9: a destination typed with a stray leading `d` silently created
 * `d/nonexistent-root-xyz/out/`, and the result screen showed two filenames
 * and a size — no folder anywhere. "Where is it?" is the one question the
 * result has to answer, and it lives in history, so it stays answered in the
 * scrollback after the next conversion starts.
 */
const source: SourceInfo = {
  kind: 'image',
  path: '/tmp/big.png',
  format: 'png',
  width: 10,
  height: 10,
  bytes: 85_400,
  hasAlpha: false,
  frames: 1,
}

const resultIn = (folder: string, name = 'big.jpg'): Result => ({
  job: {
    op: 'convert',
    sources: [source],
    outputs: [join(folder, name)],
    target: 'jpeg',
    options: { background: '#ffffff', keepMetadata: false },
  },
  outputBytes: 18_400,
  warnings: [],
})

const frameOf = (result: Result, width: number) =>
  render(
    <ThemeProvider palette={DARK}>
      <HistoryEntry block={{ kind: 'result', id: 'r', result }} width={width} />
    </ThemeProvider>,
  ).lastFrame() ?? ''

describe('the result says where the file went', () => {
  const desktop = join(homedir(), 'Desktop')

  it('names the folder, ~-abbreviated, under the panels', () => {
    expect(frameOf(resultIn(desktop), 100)).toContain(`   in ${join('~', 'Desktop')}`)
  })

  it('names it in a narrow terminal too', () => {
    expect(frameOf(resultIn(desktop), 50)).toContain(`   in ${join('~', 'Desktop')}`)
  })

  it('names it when the file has a long name', () => {
    const frame = frameOf(resultIn(desktop, 'Screenshot 2026-08-17 at 3.52.36 PM.jpg'), 92)
    expect(frame).toContain('✓ Screenshot 2026-08-17 at 3.52.36 PM.jpg')
    expect(frame).toContain(`   in ${join('~', 'Desktop')}`)
  })

  it('shows the whole accidental path, which is the point', () => {
    const typo = join(homedir(), 'd', 'nonexistent-root-xyz', 'out')
    expect(frameOf(resultIn(typo), 100)).toContain(
      `in ${join('~', 'd', 'nonexistent-root-xyz', 'out')}`,
    )
  })

  it('leaves a folder outside home absolute', () => {
    expect(frameOf(resultIn('/Volumes/Backup'), 100)).toContain(`in ${join('/Volumes/Backup')}`)
  })

  it('sits on its own line after the sizes', () => {
    const lines = frameOf(resultIn(desktop), 100).split('\n')
    const sizes = lines.findIndex((l) => l.includes('% smaller'))
    const saved = lines.findIndex((l) => l.startsWith('   in '))
    expect(sizes).toBeGreaterThan(-1)
    expect(saved).toBeGreaterThan(sizes)
  })

  it('names it under a page operation note, which reports through a note block', () => {
    const frame =
      render(
        <ThemeProvider palette={DARK}>
          <HistoryEntry
            block={{
              kind: 'note',
              id: 'n',
              text: '✓ split into 4 files',
              savedTo: join(desktop, 'doc-1.pdf'),
            }}
            width={80}
          />
        </ThemeProvider>,
      ).lastFrame() ?? ''
    const lines = frame.split('\n')
    expect(lines[0]).toContain('split into 4 files')
    expect(frame).toContain(`saved to ${join('~', 'Desktop')}`)
  })

  it('leaves an ordinary note alone', () => {
    const frame =
      render(
        <ThemeProvider palette={DARK}>
          <HistoryEntry block={{ kind: 'note', id: 'n', text: 'hello' }} width={80} />
        </ThemeProvider>,
      ).lastFrame() ?? ''
    expect(frame).not.toContain('saved to')
  })

  it('ellipses a long folder rather than overflowing', () => {
    const deep = join('/Volumes', 'x'.repeat(30), 'y'.repeat(30), 'z'.repeat(30))
    for (const w of [40, 56, 80, 100]) {
      const frame = frameOf(resultIn(deep), w)
      expect(frame).toContain(`in ${join('/Volumes')}`)
      for (const line of frame.split('\n')) expect(line.length).toBeLessThanOrEqual(w)
    }
  })
})
