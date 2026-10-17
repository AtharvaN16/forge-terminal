import { describe, expect, it } from 'vitest'
import { type Editor, openEditor, press, stepsOf } from '../../src/shell/preset-editor.js'

/**
 * Continue editing (W2, mockups/presets-2026-10.html): one window, every
 * operation a row. ↑↓ choose, space selects, → opens the row's own window,
 * ←→ move a slider, ↵ confirms a row's window.
 */
const open = (cutout = true) =>
  openEditor({
    target: 'webp',
    quality: 80,
    targets: ['jpeg', 'webp', 'avif', 'png'],
    scales: [2, 3, 4],
    cutout,
  })
const ids = (e: Editor) => e.rows.map((r) => r.id)
const at = (e: Editor) => e.rows[e.at]?.id
const keys = (e: Editor, ...ks: Parameters<typeof press>[1][]) => ks.reduce(press, e)

describe('the Continue editing window', () => {
  it('lists every operation, the convert just done already selected', () => {
    const e = open()
    expect(ids(e)).toEqual([
      'convert',
      'quality',
      'compress',
      'resize',
      'trim',
      'crop',
      'sharpen',
      'boost',
      'cutout',
    ])
    expect(e.rows[0]).toMatchObject({ id: 'convert', on: true, value: 'webp' })
    expect(e.rows[1]).toMatchObject({ id: 'quality', on: true, value: 80 })
    expect(e.rows.slice(2).every((r) => !r.on)).toBe(true)
  })

  it('has no Remove background row where it is not offered', () => {
    expect(ids(open(false))).not.toContain('cutout')
  })

  it('opens on the first row not selected', () => {
    expect(at(open())).toBe('compress')
  })

  it('moves with ↑↓ and stops at the ends', () => {
    expect(at(keys(open(), 'down'))).toBe('resize')
    expect(at(keys(open(), 'up', 'up', 'up', 'up'))).toBe('convert')
  })

  it('selects a row with nothing to ask with space, and unselects it again', () => {
    const on = keys(open(), 'down', 'down', 'space') // Trim edges
    expect(on.rows[4]).toMatchObject({ id: 'trim', on: true })
    expect(keys(on, 'space').rows[4]).toMatchObject({ id: 'trim', on: false })
  })

  it('opens the row’s own window when space selects a row that has no answer yet', () => {
    const e = keys(open(), 'down', 'space') // Resize
    expect(e.sub).toMatchObject({ id: 'resize' })
    expect(e.rows[3]?.on).toBe(false)
  })

  it('takes a typed width in Resize’s window; ↵ selects the row', () => {
    const e = keys(
      open(),
      'down',
      'right',
      { digit: '1' },
      { digit: '9' },
      { digit: '2' },
      { digit: '0' },
      'enter',
    )
    expect(e.sub).toBeUndefined()
    expect(e.rows[3]).toMatchObject({ id: 'resize', on: true, value: { width: 1920 } })
  })

  it('unselecting keeps the answer, so space brings it back', () => {
    const typed = keys(
      open(),
      'down',
      'right',
      { digit: '8' },
      { digit: '0' },
      { digit: '0' },
      'enter',
    )
    const off = keys(typed, 'space')
    expect(off.rows[3]).toMatchObject({ on: false, value: { width: 800 } })
    expect(stepsOf(off).resize).toBeUndefined()
    expect(keys(off, 'space').rows[3]).toMatchObject({ on: true, value: { width: 800 } })
  })

  it('moves the quality slider with ←→ by one, and with shift by ten', () => {
    const q = keys(open(), 'up') // Quality
    expect(keys(q, 'left').rows[1]?.value).toBe(79)
    expect(keys(q, 'shiftRight', 'shiftRight', 'shiftRight').rows[1]?.value).toBe(100)
  })

  it('picks a format from Convert to’s window', () => {
    const e = keys(open(), 'up', 'up', 'right', 'down', 'enter')
    expect(e.rows[0]).toMatchObject({ id: 'convert', on: true, value: 'avif' })
  })

  it('picks a shape and a scale from their windows', () => {
    const crop = keys(open(), 'down', 'down', 'down', 'right', 'down', 'down', 'enter')
    expect(crop.rows[5]).toMatchObject({ id: 'crop', on: true, value: { w: 16, h: 9 } })
    const boost = keys(open(), 'down', 'down', 'down', 'down', 'down', 'right', 'down', 'enter')
    expect(boost.rows[7]).toMatchObject({ id: 'boost', on: true, value: 3 })
  })

  it('takes a target size in KB in Compress’s window', () => {
    const e = keys(open(), 'right', { digit: '5' }, { digit: '0' }, { digit: '0' }, 'enter')
    expect(e.rows[2]).toMatchObject({ id: 'compress', on: true, value: 500_000 })
  })

  it('closes a row’s window with ←, changing nothing', () => {
    const e = keys(open(), 'down', 'right', { digit: '9' }, 'left')
    expect(e.sub).toBeUndefined()
    expect(e.rows[3]).toMatchObject({ on: false })
  })

  it('is the steps of the selected rows only', () => {
    const e = keys(
      open(),
      'down',
      'right',
      { digit: '1' },
      { digit: '9' },
      { digit: '2' },
      { digit: '0' },
      'enter',
      'down',
      'down',
      'down',
      'space', // Sharpen
    )
    expect(stepsOf(e)).toEqual({ to: 'webp', quality: 80, resize: { width: 1920 }, sharpen: true })
    const noConvert = keys(e, 'up', 'up', 'up', 'up', 'up', 'up', 'space')
    expect(stepsOf(noConvert).to).toBeUndefined()
  })
})
