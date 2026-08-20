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

  it('draws every line to one width', () => {
    const stage = addToStage(emptyStage(), [doc('/inv/jan.pdf', 3), doc('/inv/feb.pdf', 2)], [])
    // Not `.map(stringWidth)` — the classic `.map(parseInt)` trap: `.map`
    // also passes the index, which `stringWidth`'s second parameter would
    // then read as its `options` argument.
    const widths = new Set(
      frame(stage)
        .filter((l) => l !== '')
        .map((l) => stringWidth(l)),
    )
    expect(widths.size).toBe(1)
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
