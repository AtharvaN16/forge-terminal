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
    expect(trailOf(state, ctx())).toEqual({ answers: ['Extract'], current: '#F26E69' })
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
    expect(trailOf(state, ctx())).toEqual({ answers: ['Extract'], current: 'Scale' })
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

describe('the steps (C1)', () => {
  const BLUE = { r: 101, g: 121, b: 253 }
  const TAB = key('\t', { tab: true })
  const BACKTAB = key('', { tab: true, shift: true })
  const onScale = () => initial({ scale: BLUE })

  it('s starts with the set in hand; → makes it Even, keeping the ends', () => {
    let { state } = run(onScale(), key('s'))
    expect(state.stepsEdit).toMatchObject({ field: 'set' })
    ;({ state } = run(state, RIGHT))
    expect(state.steps).toEqual({ set: 'even', start: 50, end: 950, count: 11 })
    ;({ state } = run(state, ENTER))
    expect(state.stepsEdit).toBeUndefined()
    expect(state.steps.set).toBe('even')
  })

  it('tab goes through what the set lets you change: Tailwind its ends, Even its count too, Radix nothing', () => {
    expect(run(onScale(), key('s'), TAB, TAB, TAB).state.stepsEdit?.field).toBe('set')
    const even = run(onScale(), key('s'), RIGHT, TAB, TAB, TAB).state
    expect(even.stepsEdit?.field).toBe('count')
    const radix = run(onScale(), key('s'), RIGHT, RIGHT, TAB).state
    expect(radix.steps.set).toBe('radix')
    expect(radix.stepsEdit?.field).toBe('set')
  })

  it('the count goes from 3 to 21 and stops there; the ends move in 50s', () => {
    const at = (...keys: Action[]) => run(onScale(), key('s'), RIGHT, ...keys).state.steps
    expect(at(TAB, LEFT).start).toBe(0)
    expect(at(TAB, TAB, RIGHT).end).toBe(1000)
    expect(at(TAB, TAB, TAB, ...Array(20).fill(LEFT)).count).toBe(3)
    expect(at(TAB, TAB, TAB, ...Array(20).fill(RIGHT)).count).toBe(21)
  })

  it('the set stops at Tailwind and at Radix rather than wrapping', () => {
    expect(run(onScale(), key('s'), LEFT).state.steps.set).toBe('tailwind')
    expect(run(onScale(), key('s'), RIGHT, RIGHT, RIGHT).state.steps.set).toBe('radix')
  })

  it('esc puts the steps back as they were and leaves nothing else', () => {
    const { state, effects } = run(onScale(), key('s'), RIGHT, TAB, LEFT, ESC)
    expect(state.steps).toEqual({ set: 'tailwind', start: 50, end: 950, count: 11 })
    expect(state.stepsEdit).toBeUndefined()
    expect(effects).toEqual([])
    expect(top(state)?.kind).toBe('scale')
  })

  it('keeps the chosen step on the same place when the steps change; Radix finds the colour at 9', () => {
    // 800 is the ninth of the default steps.
    let { state } = run(onScale(), RIGHT, RIGHT, RIGHT)
    expect(top(state)).toMatchObject({ sel: 8 })
    // Even over 0–1000 with 21 steps: 800 is the seventeenth.
    ;({ state } = run(
      state,
      key('s'),
      RIGHT,
      TAB,
      LEFT,
      TAB,
      RIGHT,
      TAB,
      ...Array(10).fill(RIGHT),
      ENTER,
    ))
    expect(state.steps).toEqual({ set: 'even', start: 0, end: 1000, count: 21 })
    expect(top(state)).toMatchObject({ sel: 16 })
    const radix = run(onScale(), key('s'), RIGHT, RIGHT, ENTER).state
    expect(top(radix)).toMatchObject({ sel: 8 })
  })

  it('other keys do nothing while the steps are being changed', () => {
    const { state, effects } = run(onScale(), key('s'), key('c'), key('r'), key('#'))
    expect(effects).toEqual([])
    expect(state.field.focus).toBe(false)
    expect(state.stepsEdit).toBeDefined()
  })

  it('a new colour and a new centre keep the steps, and start on the colour', () => {
    const steps = { set: 'radix', start: 50, end: 950, count: 11 } as const
    let { state } = run(
      initial('scale', steps),
      { type: 'text', text: '#6579FD' },
      { type: 'submit' },
    )
    expect(top(state)).toMatchObject({ sel: 8 })
    ;({ state } = run(state, RIGHT, RIGHT, key('r')))
    expect(state.steps).toEqual(steps)
    expect(top(state)).toMatchObject({ kind: 'scale', sel: 8, from: 'was 11 of #6579FD' })
    expect(state.flash?.text).toMatch(/is now 9 ·/)
  })

  it('esc puts the chosen step back, however far the values went meanwhile', () => {
    const at950 = run(onScale(), ...Array(5).fill(RIGHT)).state
    expect(top(at950)).toMatchObject({ sel: 10 })
    const { state } = run(at950, key('s'), TAB, TAB, ...Array(8).fill(LEFT), ESC)
    expect(state.steps).toEqual({ set: 'tailwind', start: 50, end: 950, count: 11 })
    expect(top(state)).toMatchObject({ sel: 10 })
  })

  it('a value moved away and back finds the chosen step again', () => {
    const at950 = run(onScale(), ...Array(5).fill(RIGHT)).state
    const { state } = run(at950, key('s'), TAB, TAB, LEFT, LEFT, RIGHT, RIGHT)
    expect(state.steps.end).toBe(950)
    expect(top(state)).toMatchObject({ sel: 10 })
  })

  it('shift-tab goes back a value', () => {
    const { state } = run(onScale(), key('s'), BACKTAB)
    expect(state.stepsEdit?.field).toBe('end')
  })
})
