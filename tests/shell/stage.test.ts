import { describe, expect, it } from 'vitest'
import type { FolderScan } from '../../src/core/folder.js'
import type { DocumentInfo, ImageInfo } from '../../src/core/types.js'
import {
  addToStage,
  clearStage,
  emptyStage,
  folderStage,
  stagedVerb,
  stagedView,
  stageSummary,
  underField,
} from '../../src/shell/stage.js'

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

describe('a dropped folder', () => {
  const img2: ImageInfo = { ...img, path: '/f/b.jpg' }
  const scan: FolderScan = {
    dir: '/f/images',
    sources: [img, img2],
    failures: [],
    kinds: [{ id: 'images', count: 2, bytes: 4096, sources: [img, img2] }],
    bytes: 4096,
    paths: ['/a.jpg', '/f/b.jpg'],
  }
  const folder = folderStage(scan)

  it('stages the folder’s files, and the folder', () => {
    expect(folder.sources).toHaveLength(2)
    expect(folder.folder).toBe(scan)
  })

  it('converts on ↵ in convert mode, as one folder, whatever it holds', () => {
    expect(stagedVerb(folder, 'convert')).toBe('convert')
    expect(stagedVerb(folderStage({ ...scan, sources: [img] }), 'convert')).toBe('convert')
  })

  it('is a list of files as before in the other modes', () => {
    expect(stagedVerb(folder, 'compress')).toBeNull()
  })

  it('has no “coming” note in convert mode', () => {
    expect(underField(folder, 'convert')).toBeUndefined()
    expect(underField(folder, 'compress')?.kind).toBe('note')
  })

  it('stops being a folder once another file joins it', () => {
    expect(addToStage(folder, [{ ...img, path: '/c.jpg' }], []).folder).toBeUndefined()
  })

  it('draws the folder’s card on home in convert mode only', () => {
    expect(stagedView(folder, 0, 'convert').folder).toEqual({
      name: 'images',
      lines: ['2 images · 4.1 KB'],
    })
    expect(stagedView(folder, 0, 'compress').folder).toBeUndefined()
  })
})
