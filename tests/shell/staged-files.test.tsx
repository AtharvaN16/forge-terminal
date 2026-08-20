import { render } from 'ink-testing-library'
import { createElement } from 'react'
import stringWidth from 'string-width'
import { describe, expect, it } from 'vitest'
import type { DocumentInfo } from '../../src/core/types.js'
import { StagedFiles } from '../../src/shell/components/StagedFiles.js'
import { addToStage, emptyStage } from '../../src/shell/stage.js'

const doc = (path: string, pages: number): DocumentInfo => ({
  kind: 'document',
  path,
  format: 'pdf',
  bytes: 240_000,
  pages,
  encrypted: false,
})

const frame = (stage: ReturnType<typeof emptyStage>, width = 80) => {
  const { lastFrame } = render(createElement(StagedFiles, { stage, width }))
  return (lastFrame() ?? '').split('\n')
}

describe('StagedFiles', () => {
  it('draws a framed list with the count in the tag', () => {
    const stage = addToStage(emptyStage(), [doc('/inv/jan.pdf', 3), doc('/inv/feb.pdf', 2)], [])
    const lines = frame(stage)
    expect(lines[0]).toContain('PDF ×2')
    expect(lines.join('\n')).toContain('jan.pdf')
    expect(lines.join('\n')).toContain('5 pages')
  })

  // 80 and 60 render byte-identical here: MAX_CARD = 52 caps `outer` for
  // the whole non-compact range, so nothing above the compact cutoff (60)
  // ever draws a frame narrower than 52 regardless of how much wider the
  // terminal is. 52 — the cap itself, comfortably inside the compact band
  // — exercises a genuinely different value than 40 does (the compact
  // line's own width budget shrinks with the terminal, so 52 and 40 do not
  // truncate the same way), which 60 never would.
  it('draws every line to one width, at 80, 52 and 40 columns', () => {
    const stage = addToStage(emptyStage(), [doc('/inv/jan.pdf', 3), doc('/inv/feb.pdf', 2)], [])
    for (const width of [80, 52, 40]) {
      // Not `.map(stringWidth)` — the classic `.map(parseInt)` trap: `.map`
      // also passes the index, which `stringWidth`'s second parameter would
      // then read as its `options` argument.
      const lines = frame(stage, width).filter((l) => l !== '')
      const widths = new Set(lines.map((l) => stringWidth(l)))
      expect(widths.size).toBe(1)
      for (const line of lines) expect(stringWidth(line)).toBeLessThanOrEqual(width)
    }
  })

  it('drops the frame below the compact band, same as FileCard', () => {
    const stage = addToStage(emptyStage(), [doc('/inv/jan.pdf', 3), doc('/inv/feb.pdf', 2)], [])
    const lines = frame(stage, 40)
    expect(lines.join('\n')).not.toContain('╭')
    expect(lines.join('\n')).not.toContain('╰')
    // Still says what's staged, just without the border.
    expect(lines.join('\n')).toContain('PDF ×2')
  })

  it('lists three files and counts the rest', () => {
    const many = Array.from({ length: 30 }, (_, i) => doc(`/scans/scan-${i}.pdf`, 8))
    const lines = frame(addToStage(emptyStage(), many, [])).join('\n')
    expect(lines).toContain('… 27 more')
  })

  it('tags each row when the types are mixed', () => {
    const stage = addToStage(emptyStage(), [doc('/a.pdf', 1)], [])
    const mixed = addToStage(
      stage,
      [
        {
          kind: 'image',
          path: '/b.jpg',
          format: 'jpeg',
          bytes: 1,
          width: 1,
          height: 1,
          hasAlpha: false,
          frames: 1,
        },
      ],
      [],
    )
    const lines = frame(mixed).join('\n')
    expect(lines).toContain('MIXED ×2')
    expect(lines).toContain('JPEG')
  })

  it('reports skipped files outside the frame', () => {
    const stage = addToStage(
      emptyStage(),
      [doc('/a.pdf', 1)],
      [
        {
          path: '/notes.txt',
          error: {
            code: 'unsupported-source',
            title: 'x',
            detail: 'not a format Forge reads',
          } as never,
        },
      ],
    )
    const lines = frame(stage).join('\n')
    expect(lines).toContain('1 skipped')
    expect(lines).toContain('notes.txt')
  })
})
