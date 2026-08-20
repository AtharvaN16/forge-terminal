import { describe, expect, it } from 'vitest'
import type { DocumentInfo, ImageInfo } from '../../src/core/types.js'
import { addToStage, clearStage, emptyStage, stageSummary } from '../../src/shell/stage.js'

const doc = (path: string, pages: number, bytes: number): DocumentInfo => ({
  kind: 'document',
  path,
  format: 'pdf',
  bytes,
  pages,
  encrypted: false,
})
const img: ImageInfo = {
  kind: 'image',
  path: '/a.jpg',
  format: 'jpeg',
  bytes: 2048,
  width: 10,
  height: 10,
  hasAlpha: false,
  frames: 1,
}

describe('the staged list', () => {
  it('starts empty', () => {
    expect(emptyStage().sources).toEqual([])
  })

  it('accumulates across drops', () => {
    let stage = emptyStage()
    stage = addToStage(stage, [doc('/a.pdf', 3, 100)], [])
    stage = addToStage(stage, [doc('/b.pdf', 2, 100)], [])
    expect(stage.sources.map((s) => s.path)).toEqual(['/a.pdf', '/b.pdf'])
  })

  it('does not stage the same file twice', () => {
    let stage = emptyStage()
    stage = addToStage(stage, [doc('/a.pdf', 3, 100)], [])
    stage = addToStage(stage, [doc('/a.pdf', 3, 100)], [])
    expect(stage.sources).toHaveLength(1)
  })

  it('clears back to empty', () => {
    const stage = addToStage(emptyStage(), [doc('/a.pdf', 3, 100)], [])
    expect(clearStage().sources).toEqual([])
    expect(stage.sources).toHaveLength(1)
  })

  it('summarises documents with a page total', () => {
    let stage = emptyStage()
    stage = addToStage(stage, [doc('/a.pdf', 3, 1024), doc('/b.pdf', 2, 1024)], [])
    expect(stageSummary(stage)).toBe('2 files · 5 pages · 2 KB')
  })

  it('omits the page total when nothing staged has pages', () => {
    const stage = addToStage(emptyStage(), [img], [])
    expect(stageSummary(stage)).toBe('1 file · 2 KB')
  })
})
