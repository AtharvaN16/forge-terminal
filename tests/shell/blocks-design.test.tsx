import { render } from 'ink-testing-library'
import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import type { Result, SourceInfo } from '../../src/core/types.js'
import { HistoryEntry } from '../../src/shell/blocks.js'
import { FileCard } from '../../src/shell/components/FileCard.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { DARK, LIGHT } from '../../src/shell/theme.js'

const source: SourceInfo = {
  kind: 'image',
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
      op: 'convert',
      sources: [source],
      outputs: ['/tmp/diagram.webp'],
      target: 'webp',
      options: { background: '#ffffff', keepMetadata: false },
    },
    outputBytes: 114_688,
    warnings: [],
  }

  it('carries symbol and word, not colour alone', () => {
    const frame = frameOf(<HistoryEntry block={{ kind: 'result', id: 'r1', result }} width={80} />)
    expect(frame).toContain('✓ diagram.webp')
    // B6a: the formats say what it was; "was" and "now" say which size is which.
    expect(frame).toMatch(/^ {3}PNG → WebP$/m)
    expect(frame).toMatch(/now 115 KB +was 348 KB$/m)
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

describe('result block, as Done leaves it in the scrollback', () => {
  const result: Result = {
    job: {
      op: 'convert',
      sources: [source],
      outputs: ['/tmp/diagram.gif'],
      target: 'gif',
      options: { background: '#ffffff', keepMetadata: false },
    },
    outputBytes: 133_120,
    warnings: [],
  }
  const block = { kind: 'result' as const, id: 'r2', result }

  it('draws one bar with the change in it, the sizes two rows under it', () => {
    const lines = frameOf(<HistoryEntry block={block} width={100} />).split('\n')
    const bar = lines.findIndex((l) => l.includes('✓ diagram.gif'))
    expect(lines[bar]).toMatch(/\d+(\.\d)?% smaller$/)
    expect(lines[bar + 3]).toMatch(/^ {3}now 133 KB +was 348 KB$/)
  })

  it('keeps a warning in the record, under the folder', () => {
    const warned = {
      ...block,
      result: {
        ...result,
        warnings: [{ code: 'animation-flattened' as const, message: 'Only the first frame.' }],
      },
    }
    const lines = frameOf(<HistoryEntry block={warned} width={100} />).split('\n')
    const folder = lines.findIndex((l) => l.startsWith('   in '))
    expect(lines[folder + 2]).toBe('   ⚠ Only the first frame.')
  })

  it('has no keys and no frame: the screen it came from had those', () => {
    const frame = frameOf(<HistoryEntry block={block} width={100} />)
    expect(frame).not.toContain('╭')
    expect(frame).not.toContain('convert another')
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
      op: 'convert',
      sources: [long],
      outputs: ['/tmp/Screenshot 2026-08-17 at 3.52.36 PM.gif'],
      target: 'gif',
      options: { background: '#ffffff', keepMetadata: false },
    },
    outputBytes: 133_120,
    warnings: [],
  }
  const block = { kind: 'result' as const, id: 'r3', result }

  it('shows the new file’s full name where there is room for it and the change', () => {
    const frame = frameOf(<HistoryEntry block={block} width={92} />)
    expect(frame).toContain('✓ Screenshot 2026-08-17 at 3.52.36 PM.gif')
    expect(frame).toMatch(/% smaller$/m)
    expect(frame).not.toContain('…')
  })

  it('never overflows, whatever the names', () => {
    for (const w of [56, 60, 80, 92, 120]) {
      const frame = frameOf(<HistoryEntry block={block} width={w} />)
      for (const line of frame.split('\n')) expect(line.length).toBeLessThanOrEqual(w)
    }
  })
})
