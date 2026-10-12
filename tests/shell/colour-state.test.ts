import { describe, expect, it } from 'vitest'
import {
  type Action,
  type ColourState,
  type Ctx,
  type Effect,
  initial,
  type KeyLike,
  reduce,
  trailOf,
} from '../../src/shell/colour/state.js'

/** A fake palette: six colours at the top; the coral (5) opens into four shades. */
const TOP = ['#356723', '#77A726', '#AD95E9', '#ACE02C', '#6579FD', '#F26E69']
const CORAL = ['#FD6457', '#E795A9', '#DD7EA0', '#C05D3F']
const ctx = (now = 0): Ctx => ({
  colours: (level) => (level.length === 0 ? TOP : level[0] === 5 ? CORAL : []),
  canOpen: (level, i) => level.length === 0 && i === 5,
  now,
})

const NONE: KeyLike = {}
const key = (input: string, k: KeyLike = NONE): Action => ({ type: 'key', input, key: k })
const UP = key('', { upArrow: true })
const DOWN = key('', { downArrow: true })
const LEFT = key('', { leftArrow: true })
const RIGHT = key('', { rightArrow: true })
const ENTER = key('', { return: true })
const ESC = key('', { escape: true })

function run(state: ColourState, ...actions: Action[]): { state: ColourState; effects: Effect[] } {
  let s = state
  const effects: Effect[] = []
  for (const a of actions) {
    const out = reduce(s, a, ctx())
    s = out.state
    effects.push(...out.effects)
  }
  return { state: s, effects }
}
const top = (s: ColourState) => s.history[s.history.length - 1]
const opened: Action = {
  type: 'opened',
  path: '/p/sonoma.jpg',
  name: 'sonoma.jpg',
  meta: '640×640 · 58 KB',
}
const onPalette = () => run(initial({ palette: '/p/sonoma.jpg' }), opened).state

describe('starting', () => {
  it('# on colour home opens the scale with # already typed', () => {
    const s = initial({ typed: '#' })
    expect(s.history).toEqual([{ kind: 'scale-empty' }])
    expect(s.field).toMatchObject({ text: '#', focus: true })
  })
})

describe('typing', () => {
  it('# on a scale opens the field with # typed', () => {
    const { state } = run(initial({ scale: { r: 101, g: 121, b: 253 } }), key('#'))
    expect(state.field).toMatchObject({ text: '#', focus: true })
  })

  it('a whole hex shows its scale at once; ↵ keeps it', () => {
    let { state } = run(initial('scale'), { type: 'text', text: '#6579F' })
    expect(top(state)?.kind).toBe('scale-empty')
    ;({ state } = run(state, { type: 'text', text: '#6579FD' }))
    expect(state.preview).toEqual({ r: 101, g: 121, b: 253 })
    ;({ state } = run(state, { type: 'submit' }))
    expect(top(state)).toMatchObject({ kind: 'scale', ref: { r: 101, g: 121, b: 253 }, sel: 5 })
    expect(state.history).toHaveLength(1)
    expect(state.field.focus).toBe(false)
  })

  it('/, ~ or a drop on the palette opens the field with it', () => {
    for (const input of ['/', '~', '/Users/me/b.png']) {
      const { state } = run(onPalette(), key(input))
      expect(state.field, input).toMatchObject({ text: input, focus: true })
    }
  })

  it('c, r and s are keys when the field is at rest, and text while it has focus', () => {
    const resting = run(onPalette(), key('c'))
    expect(resting.effects).toContainEqual({ type: 'copy-all' })
    expect(resting.state.field.focus).toBe(false)
    // While focused, the field's editor takes letters; the reducer ignores them.
    const focused = run(onPalette(), key('/'), key('c'), key('r'), key('s'))
    expect(focused.effects).toEqual([])
    expect(top(focused.state)?.kind).toBe('palette')
  })

  it('esc in the field puts the last value back and leaves the field', () => {
    const { state } = run(onPalette(), key('/'), { type: 'text', text: '/tmp/x' }, ESC)
    expect(state.field).toMatchObject({ text: '/p/sonoma.jpg', focus: false })
    expect(top(state)?.kind).toBe('palette')
  })
})

describe('the palette', () => {
  it('opens on the first colour; ↑↓ move', () => {
    let { state } = run(onPalette(), DOWN, DOWN)
    expect(top(state)).toMatchObject({ kind: 'palette', sel: 2 })
    ;({ state } = run(state, UP))
    expect(top(state)).toMatchObject({ sel: 1 })
  })

  it('↵ copies the hex and says so', () => {
    const { effects, state } = run(onPalette(), DOWN, ENTER)
    expect(effects).toContainEqual({ type: 'copy', text: '#77A726' })
    expect(state.flash?.text).toBe('copied #77A726')
  })

  it('c copies all, as many swatches as there are colours', () => {
    const { effects, state } = run(onPalette(), key('c'))
    expect(effects).toContainEqual({ type: 'copy-all' })
    expect(state.flash?.text).toBe('copied 6 swatches')
  })

  it('→ goes inside a colour that has shades, and only then; ← and esc come back', () => {
    let { state } = run(onPalette(), RIGHT)
    expect(state.history).toHaveLength(1)
    ;({ state } = run(state, DOWN, DOWN, DOWN, DOWN, DOWN, RIGHT))
    expect(top(state)).toMatchObject({ kind: 'palette', level: [5], sel: 0 })
    expect(trailOf(state, ctx())).toEqual({ answers: ['Palette'], current: '#F26E69' })
    ;({ state } = run(state, LEFT))
    expect(top(state)).toMatchObject({ level: [], sel: 5 })
    ;({ state } = run(state, RIGHT, ESC))
    expect(top(state)).toMatchObject({ level: [], sel: 5 })
  })

  it('s makes a scale from the chosen colour; esc returns to the palette', () => {
    let { state } = run(onPalette(), DOWN, DOWN, DOWN, DOWN, key('s'))
    expect(top(state)).toMatchObject({
      kind: 'scale',
      ref: { r: 101, g: 121, b: 253 },
      from: 'from sonoma.jpg',
      sel: 5,
    })
    expect(trailOf(state, ctx())).toEqual({ answers: ['Palette'], current: 'Scale' })
    ;({ state } = run(state, ESC))
    expect(top(state)).toMatchObject({ kind: 'palette', sel: 4 })
  })

  it('a typed colour on the palette makes a scale from it', () => {
    const { state } = run(
      onPalette(),
      key('#'),
      { type: 'text', text: '#E8B44C' },
      { type: 'submit' },
    )
    expect(top(state)).toMatchObject({ kind: 'scale', ref: { r: 232, g: 180, b: 76 } })
    expect(state.history).toHaveLength(2)
  })

  it('a drop into the empty field opens it at once; typing a path waits for ↵', () => {
    const dropped = run(initial('palette'), { type: 'text', text: '/x/photo.jpg' })
    expect(dropped.effects).toContainEqual({ type: 'open', path: '/x/photo.jpg' })
    const typed = run(initial('palette'), { type: 'text', text: '/' }, { type: 'text', text: '/x' })
    expect(typed.effects).toEqual([])
  })

  it('a path that is not an image is refused, the text kept, the palette kept', () => {
    let { state, effects } = run(
      onPalette(),
      key('/'),
      { type: 'text', text: '/x/report.pdf' },
      { type: 'submit' },
    )
    expect(effects).toContainEqual({ type: 'open', path: '/x/report.pdf' })
    ;({ state } = run(state, { type: 'refused', message: 'report.pdf is a PDF, not an image.' }))
    expect(state.error).toBe('report.pdf is a PDF, not an image.')
    expect(state.field).toMatchObject({ text: '/x/report.pdf', focus: true })
    expect(top(state)?.kind).toBe('palette')
  })
})

describe('the scale', () => {
  const onScale = () => run(initial({ scale: { r: 101, g: 121, b: 253 } })).state

  it('←→ move along the steps, and stay on the scale', () => {
    let { state } = run(onScale(), RIGHT, RIGHT)
    expect(top(state)).toMatchObject({ sel: 7 })
    ;({ state } = run(state, ...Array(9).fill(RIGHT)))
    expect(top(state)).toMatchObject({ sel: 10 })
    ;({ state } = run(state, ...Array(12).fill(LEFT)))
    expect(top(state)).toMatchObject({ sel: 0 })
  })

  it('r makes the chosen step the centre; esc goes back to the colour before', () => {
    let { state } = run(onScale(), RIGHT, RIGHT, RIGHT, key('r'))
    expect(top(state)).toMatchObject({
      kind: 'scale',
      ref: { r: 0x34, g: 0x3f, b: 0x96 },
      from: 'was 800 of #6579FD',
      sel: 5,
    })
    expect(trailOf(state, ctx())).toEqual({ answers: ['#6579FD'], current: 'Scale' })
    expect(state.flash?.text).toBe('#343F96 is now 500 · esc goes back to #6579FD')
    ;({ state } = run(state, ESC))
    expect(top(state)).toMatchObject({ ref: { r: 101, g: 121, b: 253 }, sel: 8 })
  })

  it('↵ copies the chosen step', () => {
    const { effects } = run(onScale(), ENTER)
    expect(effects).toContainEqual({ type: 'copy', text: '#6579FD' })
  })
})

describe('cancelling', () => {
  it('esc in the field while an image opens cancels the open and puts the last value back', () => {
    const { state, effects } = run(
      onPalette(),
      key('/'),
      { type: 'text', text: '/x/big.png' },
      { type: 'submit' },
      { type: 'cancel' },
    )
    expect(effects).toContainEqual({ type: 'cancel-open' })
    expect(state.field).toMatchObject({ text: '/p/sonoma.jpg', focus: false })
    expect(top(state)?.kind).toBe('palette')
  })

  it("the field's esc does nothing once the field has lost focus — it never leaves colour", () => {
    const { effects } = run(onPalette(), { type: 'cancel' })
    expect(effects).toEqual([])
  })
})

describe('leaving, and the flash', () => {
  it('esc on the first screen leaves colour', () => {
    expect(run(initial('scale'), ESC).effects).toContainEqual({ type: 'back' })
    expect(run(onPalette(), ESC).effects).toContainEqual({ type: 'back' })
  })

  it('a copy confirmation clears itself after 1.5 s', () => {
    const { state } = run(onPalette(), ENTER)
    expect(reduce(state, { type: 'tick' }, ctx(1000)).state.flash).toBeDefined()
    expect(reduce(state, { type: 'tick' }, ctx(1600)).state.flash).toBeUndefined()
  })
})
