import { describe, expect, it } from 'vitest'
import { moveItem, nextSortMode, sortSources } from '../../src/core/order.js'
import type { DocumentInfo } from '../../src/core/types.js'

const doc = (path: string): DocumentInfo => ({
  kind: 'document',
  path,
  format: 'pdf',
  bytes: 1,
  pages: 1,
  encrypted: false,
})

describe('moveItem', () => {
  it('moves an item later', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a'])
  })

  it('moves an item earlier', () => {
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b'])
  })

  it('is a no-op when the position does not change', () => {
    expect(moveItem(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'b', 'c'])
  })

  it('clamps rather than dropping an item off either end', () => {
    expect(moveItem(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c'])
    expect(moveItem(['a', 'b', 'c'], 2, 9)).toEqual(['a', 'b', 'c'])
  })

  it('never loses or duplicates an item', () => {
    const out = moveItem(['a', 'b', 'c', 'd'], 3, 1)
    expect([...out].sort()).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('sortSources', () => {
  const sources = [doc('/s/c.pdf'), doc('/s/a.pdf'), doc('/s/b.pdf')]
  const mtimes = new Map([
    ['/s/c.pdf', 300],
    ['/s/a.pdf', 100],
    ['/s/b.pdf', 200],
  ])

  it('leaves the dropped order alone', () => {
    expect(sortSources(sources, 'dropped', mtimes).map((s) => s.path)).toEqual([
      '/s/c.pdf',
      '/s/a.pdf',
      '/s/b.pdf',
    ])
  })

  it('sorts by filename', () => {
    expect(sortSources(sources, 'name', mtimes).map((s) => s.path)).toEqual([
      '/s/a.pdf',
      '/s/b.pdf',
      '/s/c.pdf',
    ])
  })

  it('sorts newest first', () => {
    expect(sortSources(sources, 'newest', mtimes).map((s) => s.path)).toEqual([
      '/s/c.pdf',
      '/s/b.pdf',
      '/s/a.pdf',
    ])
  })

  it('sorts oldest first', () => {
    expect(sortSources(sources, 'oldest', mtimes).map((s) => s.path)).toEqual([
      '/s/a.pdf',
      '/s/b.pdf',
      '/s/c.pdf',
    ])
  })

  it('cycles through the four modes and back', () => {
    expect(nextSortMode('dropped')).toBe('name')
    expect(nextSortMode('name')).toBe('newest')
    expect(nextSortMode('newest')).toBe('oldest')
    expect(nextSortMode('oldest')).toBe('dropped')
  })
})
