import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { fileNotFound, targetUnreachable } from '../../src/core/errors.js'
import type { Result, SourceInfo } from '../../src/core/types.js'
import { type HistoryBlock, HistoryEntry } from '../../src/shell/blocks.js'
import { FileCard } from '../../src/shell/components/FileCard.js'
import { Hints } from '../../src/shell/components/Hints.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { DARK } from '../../src/shell/theme.js'

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

describe('FileCard', () => {
  it('shows name, size, format and dimensions', () => {
    const frame = render(<FileCard source={source} width={80} />).lastFrame() ?? ''
    expect(frame).toContain('photo.jpg')
    expect(frame).toContain('4.2 MB')
    expect(frame).toContain('JPEG')
    expect(frame).toContain('3024×4032')
  })

  it('drops the dimensions in a compact terminal', () => {
    const frame = render(<FileCard source={source} width={40} />).lastFrame() ?? ''
    expect(frame).toContain('photo.jpg')
    expect(frame).not.toContain('3024×4032')
  })
})

describe('Hints', () => {
  it('pairs each key with what it does', () => {
    const frame =
      render(
        <Hints
          pairs={[
            ['↑↓', 'choose'],
            ['↵', 'confirm'],
            ['esc', 'back'],
          ]}
        />,
      ).lastFrame() ?? ''
    expect(frame).toContain('↑↓')
    expect(frame).toContain('choose')
    expect(frame).toContain('esc')
  })
})

describe('HistoryEntry', () => {
  it('renders a result with a symbol AND a word, both sizes and the change', () => {
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
    const block: HistoryBlock = { kind: 'result', id: 'r1', result }
    const frame = render(<HistoryEntry block={block} width={80} />).lastFrame() ?? ''
    expect(frame).toContain('✓')
    expect(frame).toContain('photo.jpg')
    expect(frame).toContain('photo.webp')
    expect(frame).toContain('4.2 MB')
    expect(frame).toContain('820 KB')
    expect(frame).toContain('80.5% smaller')
  })

  it('renders a warning alongside a successful result', () => {
    const result: Result = {
      job: {
        op: 'convert',
        sources: [source],
        outputs: ['/Users/me/Desktop/photo.png'],
        target: 'png',
        options: { background: '#ffffff', keepMetadata: false },
      },
      outputBytes: 100,
      warnings: [{ code: 'animation-flattened', message: 'only the first frame was converted.' }],
    }
    const frame =
      render(
        <HistoryEntry block={{ kind: 'result', id: 'r2', result }} width={80} />,
      ).lastFrame() ?? ''
    expect(frame).toContain('⚠')
    expect(frame).toContain('only the first frame')
  })

  it('renders an error with its title, detail and hint', () => {
    const block: HistoryBlock = { kind: 'error', id: 'e1', error: fileNotFound('/a/ghost.jpg') }
    const frame = render(<HistoryEntry block={block} width={80} />).lastFrame() ?? ''
    expect(frame).toContain('failed')
    expect(frame).toContain('File not found')
    expect(frame).toContain('ghost.jpg')
    expect(frame).toContain('Check the filename')
  })

  it('shows the shell phrasing of a hint, not the CLI one', () => {
    // `targetUnreachable` carries both: `--max-size` for the CLI, `/convert`
    // here, where the slash command is the thing you can actually type.
    const error = targetUnreachable(source, 1_000, 11_600)
    const frame =
      render(<HistoryEntry block={{ kind: 'error', id: 'e2', error }} width={80} />).lastFrame() ??
      ''
    expect(frame).toContain('/convert')
    expect(frame).not.toContain('--max-size')
  })

  it('renders a plain note', () => {
    const frame =
      render(
        <HistoryEntry block={{ kind: 'note', id: 'n1', text: 'Converting 4 files' }} width={80} />,
      ).lastFrame() ?? ''
    expect(frame).toContain('Converting 4 files')
  })
})

describe('an error is hard to overlook', () => {
  it('draws the whole message as one panel under a "failed" tab, not loose lines', () => {
    // Reported: a refusal was "completely overlooked". It rendered as three
    // unstyled lines flush against the scrollback above it, indistinguishable
    // from ordinary output, so the eye slid past it. The tab and the tint
    // group the title, the reason and the way forward into a single object.
    const error = fileNotFound('/tmp/ghost.jpg')
    const frame =
      render(
        <ThemeProvider palette={DARK}>
          <HistoryEntry block={{ kind: 'error', id: 'e1', error }} width={80} />
        </ThemeProvider>,
      ).lastFrame() ?? ''
    const lines = frame.split('\n')

    expect(lines[0]).toMatch(/^\s+failed\s*$/)
    expect(frame).toContain('File not found')
    // The old red card is gone.
    expect(frame).not.toMatch(/[╭╰]/)
    // The hint has to survive inside the panel: it is the actionable half.
    expect(frame).toContain('Check the filename')
  })

  it('keeps the panel inside the width it is given', () => {
    const error = fileNotFound('/tmp/ghost.jpg')
    const frame =
      render(<HistoryEntry block={{ kind: 'error', id: 'e1', error }} width={60} />).lastFrame() ??
      ''
    for (const line of frame.split('\n')) {
      expect(line.length).toBeLessThanOrEqual(60)
    }
  })
})
