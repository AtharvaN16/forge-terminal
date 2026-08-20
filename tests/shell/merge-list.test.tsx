import { render } from 'ink-testing-library'
import { createElement } from 'react'
import stringWidth from 'string-width'
import { describe, expect, it } from 'vitest'
import type { DocumentInfo } from '../../src/core/types.js'
import { MergeList } from '../../src/shell/components/MergeList.js'

const doc = (name: string, pages: number): DocumentInfo => ({
  kind: 'document',
  path: `/inv/${name}`,
  format: 'pdf',
  bytes: 240_000,
  pages,
  encrypted: false,
})

const sources = [doc('jan.pdf', 3), doc('feb.pdf', 2), doc('mar.pdf', 12)]

const DOWN = `${String.fromCharCode(27)}[B`
/** One turn of the event loop — long enough for Ink to re-render. */
const tick = () => new Promise((r) => setTimeout(r, 20))

const app = (props: Record<string, unknown> = {}) =>
  render(
    createElement(MergeList, {
      sources,
      width: 80,
      onSubmit: () => {},
      onCancel: () => {},
      onTooFew: () => {},
      ...props,
    } as never),
  )

/** The filenames in the order the rows currently show them. */
const rowOrder = (out: string): string[] =>
  out
    .split('\n')
    .filter((l) => /\.pdf/.test(l) && !/merged/.test(l))
    .map((l) => /([\w.-]+\.pdf)/.exec(l)?.[1] ?? '')

const frame = (props: Record<string, unknown> = {}) => {
  const { lastFrame } = render(
    createElement(MergeList, {
      sources,
      width: 80,
      onSubmit: () => {},
      onCancel: () => {},
      ...props,
    } as never),
  )
  return lastFrame() ?? ''
}

describe('MergeList', () => {
  it('numbers the files in their current order', () => {
    const out = frame()
    expect(out).toMatch(/1\s+jan\.pdf/)
    expect(out).toMatch(/2\s+feb\.pdf/)
    expect(out).toMatch(/3\s+mar\.pdf/)
  })

  it('shows the page total and the output name', () => {
    const out = frame()
    expect(out).toContain('17 pages')
    expect(out).toContain('inv-merged.pdf')
  })

  it('aligns every row to one width', () => {
    const rows = frame()
      .split('\n')
      .filter((l) => /\.pdf/.test(l) && !/merged/.test(l))
    expect(new Set(rows.map((l) => stringWidth(l.trimEnd()))).size).toBeLessThanOrEqual(1)
  })

  it('names the keys, including the pick-up gesture', () => {
    const out = frame()
    expect(out).toContain('pick up')
    expect(out).toContain('sort')
    expect(out).toContain('remove')
  })

  it('marks the held row when one is picked up', () => {
    expect(frame({ heldIndex: 1 })).toContain('⇅')
  })

  /**
   * Spec §13: content is truncated, not wrapped. The name column was padded
   * to the longest filename and never truncated, so one long name pushed
   * every row past the terminal width and Ink wrapped them all.
   */
  it('truncates a name too long for the row rather than overflowing it', () => {
    const long = doc('a-scanned-invoice-from-a-supplier-with-a-very-long-name.pdf', 4)
    const out = frame({ sources: [long, doc('feb.pdf', 2)], width: 60 })
    const rows = out.split('\n').filter((l) => /\.pdf/.test(l) && !/merged/.test(l))

    expect(rows).toHaveLength(2)
    for (const row of rows) expect(stringWidth(row.trimEnd())).toBeLessThanOrEqual(60)
    expect(rows.some((r) => r.includes('…'))).toBe(true)
  })

  /**
   * `s` sorted from the as-staged list every time, so someone who dragged a
   * row by hand and then pressed `s` once could never get their arrangement
   * back: cycling round to `dropped` restored the staged order, not theirs.
   * A hand-dragged order is the more expensive thing to lose, and `dropped`
   * is the un-labelled state on screen — no `sorted: … ▾` line — so it can
   * honestly mean "the order you have" rather than "the order they arrived".
   */
  it('cycles back to a hand-dragged order, not the as-staged one', async () => {
    const { stdin, lastFrame } = app()

    stdin.write(' ') // pick up jan.pdf, the first row
    await tick()
    stdin.write(DOWN)
    await tick()
    stdin.write(DOWN) // ...and carry it to the bottom
    await tick()
    stdin.write(' ') // drop it
    await tick()
    expect(rowOrder(lastFrame() ?? '')).toEqual(['feb.pdf', 'mar.pdf', 'jan.pdf'])

    // dropped -> name -> newest -> oldest -> dropped
    for (let i = 0; i < 4; i++) {
      stdin.write('s')
      await tick()
    }

    expect(lastFrame() ?? '').not.toContain('sorted:')
    expect(rowOrder(lastFrame() ?? '')).toEqual(['feb.pdf', 'mar.pdf', 'jan.pdf'])
  })
})
