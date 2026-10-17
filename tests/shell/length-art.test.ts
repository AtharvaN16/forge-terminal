import { describe, expect, it } from 'vitest'
import { barRow, fieldsRow, handlesRow, peaksRows, stepRow } from '../../src/shell/length-art.js'
import { DARK, modePalette } from '../../src/shell/theme.js'

const p = modePalette(DARK, 'edit')
const text = (row: { text: string }[]) => row.map((r) => r.text).join('')
const W = 74

describe('the peaks', () => {
  it('draws each moment as a line as tall as it is loud, white where kept, grey where cut', () => {
    const levels = Array.from({ length: W }, (_, i) => (i % 2 ? 1 : 0.2))
    const rows = peaksRows({ palette: p, levels, start: 0, end: 65, duration: 130, width: W })
    expect(rows).toHaveLength(3)
    // A loud column fills all three rows; a quiet one only the bottom.
    const column = (i: number) => rows.map((r) => text(r)[i])
    expect(column(1)).toEqual(['│', '│', '│'])
    expect(column(0)).toEqual([' ', ' ', '╷'])
    const cut = rows[2]?.flatMap((r) => [...r.text].map((ch) => ({ ch, fg: r.fg })))
    expect(cut?.[0]?.fg).toBe(p.fg)
    expect(cut?.at(-1)?.fg).toBe(p.faint)
  })

  it('is a faint flat line when there is no sound', () => {
    const rows = peaksRows({ palette: p, levels: null, start: 0, end: 10, duration: 130, width: W })
    expect(text(rows[2] ?? [])).toBe('·'.repeat(W))
    expect(text(rows[0] ?? []).trim()).toBe('')
  })
})

describe('the bar', () => {
  it('fills what is kept in the mode’s tint and what is cut in grey, a handle at each end', () => {
    const row = barRow({
      palette: p,
      start: 13,
      end: 39,
      duration: 130,
      width: 10,
      active: 'start',
    })
    expect(row).toHaveLength(10)
    expect(row[0]?.bg).toBe(p.track)
    // 13/130 of 9 → cell 1: the chosen handle is the slider's white thumb.
    expect(row[1]?.bg).toBe(p.thumb)
    expect(row[9]?.bg).toBe(p.track)
  })

  it('can turn orange (a GIF past 15 s)', () => {
    const row = barRow({
      palette: p,
      start: 0,
      end: 130,
      duration: 130,
      width: 10,
      active: 'end',
      colour: p.larger,
    })
    expect(row[0]?.bg).toBe(p.larger)
  })
})

describe('the handles row', () => {
  it('puts the I and O chips under their handles, lit when chosen', () => {
    const row = handlesRow({
      palette: p,
      start: 30,
      end: 90,
      duration: 130,
      width: W,
      active: 'end',
    })
    const t = text(row)
    expect(t).toContain(' I ')
    expect(t).toContain(' O ')
    const o = row.find((r) => r.text === ' O ')
    expect(o?.bg).toBe(p.accent)
  })

  it('lights both for the range', () => {
    const row = handlesRow({
      palette: p,
      start: 30,
      end: 90,
      duration: 130,
      width: W,
      active: 'range',
    })
    expect(row.filter((r) => r.bg === p.accent)).toHaveLength(2)
  })
})

describe('the fields row', () => {
  it('says start and end, the chosen time on a tinted chip, tab at the far right', () => {
    const row = fieldsRow({ palette: p, start: 3.2, end: 41, width: W, active: 'start' })
    const t = text(row)
    expect(t.startsWith('start  ')).toBe(true)
    expect(t).toContain('0:03.2')
    expect(t).toContain('end  ')
    expect(t.endsWith(' tab ')).toBe(true)
    expect(t.length).toBe(W)
  })

  it('shows what is being typed in the chosen field', () => {
    const t = text(
      fieldsRow({ palette: p, start: 3.2, end: 41, width: W, active: 'end', typed: '1:0' }),
    )
    expect(t).toContain('1:0')
    expect(t).not.toContain('0:41.0')
  })
})

describe('the step', () => {
  it('reads step ‹ 1 s › at the title row’s far end', () => {
    expect(text(stepRow({ palette: p, seconds: 1, canDown: false, canUp: true }))).toBe(
      'step  ‹ 1 s ›',
    )
  })
})
