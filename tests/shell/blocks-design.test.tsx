import { render } from 'ink-testing-library'
import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import type { Result, SourceInfo } from '../../src/core/types.js'
import { HistoryEntry } from '../../src/shell/blocks.js'
import { FileCard } from '../../src/shell/components/FileCard.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { DARK, LIGHT } from '../../src/shell/theme.js'

const source: SourceInfo = {
  path: '/tmp/diagram.png',
  format: 'png',
  width: 2400,
  height: 1600,
  bytes: 348_160,
  hasAlpha: true,
  frames: 1,
}

const frameOf = (node: ReactElement, palette = DARK) =>
  render(<ThemeProvider palette={palette}>{node}</ThemeProvider>).lastFrame() ?? ''

describe('file card', () => {
  it('draws a frame with the format inlined into the top border', () => {
    const frame = frameOf(<FileCard source={source} width={80} />)
    expect(frame).toContain('╭─ PNG')
    expect(frame).toContain('╰')
    expect(frame).toContain('diagram.png')
  })

  it('reports the dimensions and the size', () => {
    const frame = frameOf(<FileCard source={source} width={80} />)
    expect(frame).toContain('2400×1600')
    expect(frame).toContain('348 KB')
  })

  it('claims transparency only when the source actually has alpha', () => {
    expect(frameOf(<FileCard source={source} width={80} />)).toContain('transparent')
    expect(frameOf(<FileCard source={{ ...source, hasAlpha: false }} width={80} />)).not.toContain(
      'transparent',
    )
  })

  it('drops the frame in the compact band rather than overflowing', () => {
    const frame = frameOf(<FileCard source={source} width={50} />)
    expect(frame).not.toContain('╭')
    expect(frame).toContain('diagram.png')
  })

  it('never overflows the terminal at any width', () => {
    for (const w of [40, 50, 60, 80, 120]) {
      const frame = frameOf(<FileCard source={source} width={w} />)
      for (const line of frame.split('\n')) expect(line.length).toBeLessThanOrEqual(w)
    }
  })

  it('draws a card of a fixed size rather than one rule across a wide terminal', () => {
    const wide = frameOf(<FileCard source={source} width={200} />)
    const top = wide.split('\n')[0] ?? ''
    expect(top.length).toBeLessThanOrEqual(52)
  })

  it('keeps its borders aligned — every drawn line is the same width', () => {
    const frame = frameOf(<FileCard source={source} width={80} />)
    const widths = new Set(frame.split('\n').map((l) => l.length))
    expect(widths.size).toBe(1)
  })

  it('truncates a very long filename instead of breaking the frame', () => {
    const long = { ...source, path: `/tmp/${'a'.repeat(300)}.png` }
    const frame = frameOf(<FileCard source={long} width={80} />)
    expect(frame).toContain('…')
    expect(new Set(frame.split('\n').map((l) => l.length)).size).toBe(1)
  })

  it('renders in either palette', () => {
    for (const palette of [DARK, LIGHT]) {
      expect(frameOf(<FileCard source={source} width={80} />, palette)).toContain('diagram.png')
    }
  })
})

describe('result block', () => {
  const result: Result = {
    job: {
      source,
      target: 'webp',
      output: '/tmp/diagram.webp',
      options: { background: '#ffffff', keepMetadata: false },
    },
    outputBytes: 114_688,
    warnings: [],
  }

  it('carries symbol and word, not colour alone', () => {
    const frame = frameOf(<HistoryEntry block={{ kind: 'result', id: 'r1', result }} width={80} />)
    expect(frame).toContain('✓ done')
    expect(frame).toContain('diagram.png')
    expect(frame).toContain('diagram.webp')
  })

  it('states the saving in words', () => {
    const frame = frameOf(<HistoryEntry block={{ kind: 'result', id: 'r1', result }} width={80} />)
    expect(frame).toMatch(/\d+% smaller/)
  })

  it('shows both sizes', () => {
    const frame = frameOf(<HistoryEntry block={{ kind: 'result', id: 'r1', result }} width={80} />)
    expect(frame).toContain('348 KB')
    expect(frame).toContain('115 KB')
  })
})

describe('result block, paired form', () => {
  // Short names on purpose: this block is about the side-by-side layout, and
  // a long name legitimately switches it to the stacked one.
  const result: Result = {
    job: {
      source,
      target: 'gif',
      output: '/tmp/diagram.gif',
      options: { background: '#ffffff', keepMetadata: false },
    },
    outputBytes: 133_120,
    warnings: [],
  }
  const block = { kind: 'result' as const, id: 'r2', result }

  it('frames the source and the output as a before and an after', () => {
    const frame = frameOf(<HistoryEntry block={block} width={100} />)
    expect(frame).toContain('╭─ PNG')
    expect(frame).toContain('╭─ GIF')
    expect(frame).toContain('→')
  })

  it('still says done in words, not colour alone', () => {
    expect(frameOf(<HistoryEntry block={block} width={100} />)).toContain('✓ done')
  })

  it('puts the sizes and the saving on their own line', () => {
    const frame = frameOf(<HistoryEntry block={block} width={100} />)
    const line = frame.split('\n').find((l) => l.includes('%')) ?? ''
    expect(line).toContain('348 KB')
    expect(line).toContain('133 KB')
    expect(line).toMatch(/\d+% smaller/)
    expect(line).not.toContain('│')
  })

  it('keeps both boxes the same height and aligned', () => {
    const frame = frameOf(<HistoryEntry block={block} width={100} />)
    const tops = frame.split('\n').filter((l) => l.includes('╭'))
    const bottoms = frame.split('\n').filter((l) => l.includes('╰'))
    // Both boxes share one line for each edge, so there is exactly one of each.
    expect(tops).toHaveLength(1)
    expect(bottoms).toHaveLength(1)
    expect(tops[0]?.split('╭')).toHaveLength(3) // two boxes on that line
  })

  it('falls back to the single-line form when two boxes will not fit', () => {
    const frame = frameOf(<HistoryEntry block={block} width={50} />)
    expect(frame).not.toContain('╭')
    expect(frame).toContain('✓ done')
    expect(frame).toMatch(/\d+% smaller/)
  })

  it('never overflows the terminal at any width', () => {
    for (const w of [40, 56, 60, 80, 100, 120]) {
      const frame = frameOf(<HistoryEntry block={block} width={w} />)
      for (const line of frame.split('\n')) expect(line.length).toBeLessThanOrEqual(w)
    }
  })
})

describe('result block, long names', () => {
  const long: SourceInfo = { ...source, path: '/tmp/Screenshot 2026-08-17 at 3.52.36 PM.png' }
  const result: Result = {
    job: {
      source: long,
      target: 'gif',
      output: '/tmp/Screenshot 2026-08-17 at 3.52.36 PM.gif',
      options: { background: '#ffffff', keepMetadata: false },
    },
    outputBytes: 133_120,
    warnings: [],
  }
  const block = { kind: 'result' as const, id: 'r3', result }

  it('stacks the boxes when a name will not fit side by side', () => {
    const frame = frameOf(<HistoryEntry block={block} width={92} />)
    // One box per row means two top edges, not one shared line.
    expect(frame.split('\n').filter((l) => l.includes('╭'))).toHaveLength(2)
    expect(frame).toContain('▼')
  })

  it('shows the full names rather than ellipsing both', () => {
    const frame = frameOf(<HistoryEntry block={block} width={92} />)
    expect(frame).toContain('Screenshot 2026-08-17 at 3.52.36 PM.png')
    expect(frame).toContain('Screenshot 2026-08-17 at 3.52.36 PM.gif')
    expect(frame).not.toContain('…')
  })

  it('still pairs them side by side when both names are short', () => {
    const short: Result = {
      ...result,
      job: {
        ...result.job,
        source: { ...long, path: '/tmp/a.png' },
        output: '/tmp/a.gif',
      },
    }
    const frame = frameOf(
      <HistoryEntry block={{ kind: 'result', id: 'r4', result: short }} width={92} />,
    )
    expect(frame.split('\n').filter((l) => l.includes('╭'))).toHaveLength(1)
  })

  it('never overflows, stacked or paired', () => {
    for (const w of [56, 60, 80, 92, 120]) {
      const frame = frameOf(<HistoryEntry block={block} width={w} />)
      for (const line of frame.split('\n')) expect(line.length).toBeLessThanOrEqual(w)
    }
  })
})
