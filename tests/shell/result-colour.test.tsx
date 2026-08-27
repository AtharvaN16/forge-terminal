import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import type { Result, SourceInfo } from '../../src/core/types.js'
import { type HistoryBlock, HistoryEntry } from '../../src/shell/blocks.js'

/**
 * Isolated in its own file rather than added to `blocks.test.tsx`: forcing
 * colour here is process-wide (`supports-color`/`chalk` read `FORCE_COLOR`
 * at evaluation time, same as `mode-header.test.tsx` needs it), and mixing
 * it into a file with plain-text assertions like "the frame stays under N
 * columns" breaks those — an SGR code adds to a raw string's `.length`
 * without adding a visible column. Confirmed the hard way: it did.
 */
vi.hoisted(() => {
  process.env.FORCE_COLOR = '3'
})

const source: SourceInfo = {
  kind: 'image',
  path: '/Users/me/Desktop/photo.jpg',
  format: 'jpeg',
  width: 3024,
  height: 4032,
  bytes: 4_200_000,
  hasAlpha: false,
  frames: 1,
}

/**
 * The colour immediately wrapping `needle`: the raw SGR escape sequence
 * that most recently preceded it, plus whatever plain text sits between
 * that code and `needle` itself. Comparing these strings rather than
 * parsing them into named colours is enough — `ok` and `warn` differ in
 * every palette this app ships (`green`/`yellow` in `NEUTRAL`, two
 * distinct hexes in `DARK`/`LIGHT`), so two different literal results here
 * already proves two different tokens were used, and an equal result
 * proves the same one was.
 */
function colourAround(frame: string, needle: string): string {
  const at = frame.indexOf(needle)
  if (at === -1) throw new Error(`"${needle}" not found in frame`)
  const before = frame.slice(0, at)
  const lastEscape = before.lastIndexOf('\x1b[')
  if (lastEscape === -1) throw new Error(`no colour code before "${needle}"`)
  return before.slice(lastEscape, before.indexOf('m', lastEscape) + 1)
}

describe('the size-change colour', () => {
  it('warns rather than celebrates when the result comes out larger', () => {
    // A lossless target re-encoding a lossy source — PNG from a JPEG — comes
    // out bigger on purpose, but "bigger" is still the opposite of what
    // green (`ok`) signals everywhere else in this app.
    const result: Result = {
      job: {
        op: 'convert',
        sources: [source],
        outputs: ['/Users/me/Desktop/photo.png'],
        target: 'png',
        options: { background: '#ffffff', keepMetadata: false },
      },
      outputBytes: 4_400_000,
      warnings: [],
    }
    const block: HistoryBlock = { kind: 'result', id: 'r-larger', result }
    const frame = render(<HistoryEntry block={block} width={80} />).lastFrame() ?? ''
    expect(frame).toContain('larger')
    const doneColour = colourAround(frame, '✓ done')
    const largerColour = colourAround(frame, 'larger')
    expect(largerColour).not.toBe(doneColour)
  })

  it('still matches the checkmark when the result comes out smaller', () => {
    const result: Result = {
      job: {
        op: 'convert',
        sources: [source],
        outputs: ['/Users/me/Desktop/photo.webp'],
        target: 'webp',
        options: { background: '#ffffff', keepMetadata: false },
      },
      outputBytes: 820_000,
      warnings: [],
    }
    const block: HistoryBlock = { kind: 'result', id: 'r-smaller', result }
    const frame = render(<HistoryEntry block={block} width={80} />).lastFrame() ?? ''
    const doneColour = colourAround(frame, '✓ done')
    const smallerColour = colourAround(frame, 'smaller')
    expect(smallerColour).toBe(doneColour)
  })
})
