import { describe, expect, it } from 'vitest'
import { gradientSteps } from '../../src/core/colour/mix.js'
import {
  type Action,
  type ColourState,
  type Ctx,
  type Effect,
  initial,
  type KeyLike,
  moreItems,
  reduce,
  trailOf,
} from '../../src/shell/colour/state.js'

/**
 * Colour mode, simpler (mockups/colour-redesign-2026-10-round5.html, the More
 * button from colour-more-copy-2026-10-round6.html, 2026-10-24): Palette is
 * the fourth of Scale's tabs; Gradient, Tweak, Steps and Mode wait behind one
 * More window; a gradient takes any number of colours; a copy says so on the
 * key row for three seconds. The reducer alone.
 */

const ctx = (now = 0): Ctx => ({ colours: () => [], canOpen: () => false, now })
const NONE: KeyLike = {}
const key = (input: string, k: KeyLike = NONE): Action => ({ type: 'key', input, key: k })
const UP = key('', { upArrow: true })
const DOWN = key('', { downArrow: true })
const RIGHT = key('', { rightArrow: true })
const SHIFT_RIGHT = key('', { rightArrow: true, shift: true })
const ENTER = key('', { return: true })
const ESC = key('', { escape: true })
const TAB = key('', { tab: true })
const BACKSPACE = key('', { backspace: true })
const text = (t: string): Action => ({ type: 'text', text: t })
const SUBMIT: Action = { type: 'submit' }

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
const BLUE = { r: 0x65, g: 0x79, b: 0xfd }
const AMBER = { r: 0xf5, g: 0xa5, b: 0x24 }
const TEAL = { r: 0x2e, g: 0xc4, b: 0xb6 }
const onScale = () => initial({ scale: BLUE })
const typeIn = (t: string): Action[] => [...t].map((ch) => key(ch))

describe('Palette is the fourth tab', () => {
  it('tab goes Colour → Neutral → Alpha → Palette → Colour', () => {
    const tabs: string[] = []
    let s = onScale()
    for (let i = 0; i < 4; i++) {
      s = run(s, TAB).state
      tabs.push(s.tab)
    }
    expect(tabs).toEqual(['neutral', 'alpha', 'palette', 'colour'])
  })

  it('the Palette card opens the scale with its Palette tab, the box ready', () => {
    const s = initial('system')
    expect(top(s)?.kind).toBe('scale-empty')
    expect(s.tab).toBe('palette')
    expect(s.field.focus).toBe(true)
    expect(trailOf(s, ctx()).current).toBe('Scale')
  })

  it('a colour typed there opens on the Palette tab, the cursor on its own cell', () => {
    const s = run(initial('system'), text('#D2042D'), SUBMIT).state
    const screen = top(s)
    expect(screen?.kind).toBe('scale')
    expect(s.tab).toBe('palette')
    expect(screen && 'cell' in screen ? screen.cell : undefined).toEqual({ row: 0, col: 5 })
  })

  it('↑↓←→ move through the grid; ↵ copies the swatch; c copies all', () => {
    const s = run(onScale(), TAB, TAB, TAB).state
    const at = top(s)
    const start = at?.kind === 'scale' ? at.cell : undefined
    expect(start?.col).toBe(5)
    const moved = run(s, DOWN, RIGHT).state
    const screen = top(moved)
    expect(screen?.kind === 'scale' ? screen.cell : undefined).toEqual({
      row: (start?.row ?? 0) + 1,
      col: 6,
    })
    expect(run(moved, ENTER).effects[0]).toMatchObject({ type: 'copy' })
    expect(run(moved, key('c')).effects).toEqual([{ type: 'copy-all' }])
    // The scale's own step has not moved.
    expect(screen?.kind === 'scale' ? screen.sel : -1).toBe(5)
  })
})

describe('More', () => {
  it('m opens the More window: Gradient, Tweak, Steps on a scale; Mode, Tweak, Steps on Palette', () => {
    const s = run(onScale(), key('m')).state
    expect(s.win).toEqual({ kind: 'more', at: 0 })
    expect(moreItems(s)).toEqual(['gradient', 'tweak', 'steps'])
    const pal = run(onScale(), TAB, TAB, TAB, key('m')).state
    expect(moreItems(pal)).toEqual(['mode', 'tweak', 'steps'])
  })

  it('↑↓ choose, ↵ opens what is chosen, esc closes it', () => {
    const tweak = run(onScale(), key('m'), DOWN, ENTER).state
    expect(tweak.win?.kind).toBe('tweak')
    const steps = run(onScale(), key('m'), DOWN, DOWN, ENTER).state
    expect(steps.win).toBeUndefined()
    expect(steps.stepsEdit?.field).toBe('set')
    const mode = run(onScale(), TAB, TAB, TAB, key('m'), ENTER).state
    expect(mode.win?.kind).toBe('mode')
    expect(run(onScale(), key('m'), ESC).state.win).toBeUndefined()
  })

  it('m again is done: it closes More, as esc does, on the first screen it was opened from', () => {
    const open = run(onScale(), key('m')).state
    expect(open.win?.kind).toBe('more')
    const done = run(open, key('m')).state
    expect(done.win).toBeUndefined()
    expect(top(done)).toEqual(top(onScale()))
    // On Palette too, and over a gradient.
    expect(run(onScale(), TAB, TAB, TAB, key('m'), key('m')).state.win).toBeUndefined()
    const gradient = run(onScale(), SHIFT_RIGHT, ...typeIn('#F5A524'), ENTER, TAB).state
    expect(run(gradient, key('m'), key('m')).state.win).toBeUndefined()
  })

  it('t and s still open Tweak and Steps at once', () => {
    expect(run(onScale(), key('t')).state.win?.kind).toBe('tweak')
    expect(run(onScale(), key('s')).state.stepsEdit?.field).toBe('set')
  })

  it('on Palette, Tweak moves the palette’s tweak, not the scale’s', () => {
    const s = run(onScale(), TAB, TAB, TAB, key('m'), DOWN, ENTER, RIGHT, ENTER).state
    expect(s.tweak.brightness).toBe(1)
    const screen = top(s)
    expect(screen?.kind === 'scale' ? screen.tweak : 'none').toBeUndefined()
  })
})

describe('Gradient', () => {
  it('opens from More, or ⇧→, with this colour first and the box empty', () => {
    const fromMore = run(onScale(), key('m'), ENTER).state.win
    expect(fromMore).toMatchObject({ kind: 'gradient', stops: [BLUE], text: '' })
    expect(run(onScale(), SHIFT_RIGHT).state.win).toMatchObject({ kind: 'gradient', stops: [BLUE] })
  })

  it('typing goes into its box; ↵ adds the colour; something that is no colour is marked', () => {
    let s = run(onScale(), SHIFT_RIGHT, ...typeIn('#F5A524')).state
    expect(s.win).toMatchObject({ text: '#F5A524' })
    s = run(s, ENTER).state
    expect(s.win).toMatchObject({ stops: [BLUE, AMBER], text: '' })
    const wrong = run(s, ...typeIn('blorpx'), ENTER).state
    expect(wrong.win).toMatchObject({ stops: [BLUE, AMBER], text: 'blorpx', wrong: true })
  })

  it('takes as many colours as you like; ⌫ on an empty box removes the chosen one', () => {
    let s = run(
      onScale(),
      SHIFT_RIGHT,
      ...typeIn('#F5A524'),
      ENTER,
      ...typeIn('#2EC4B6'),
      ENTER,
    ).state
    expect(s.win).toMatchObject({ stops: [BLUE, AMBER, TEAL] })
    // The box comes first in ↑↓'s reach; up goes to the last colour, then the one before.
    s = run(s, UP, UP, BACKSPACE).state
    expect(s.win).toMatchObject({ stops: [BLUE, TEAL] })
    // In the box, ⌫ deletes what was typed, not a colour.
    s = run(s, DOWN, DOWN, ...typeIn('#12'), BACKSPACE).state
    expect(s.win).toMatchObject({ stops: [BLUE, TEAL], text: '#1' })
  })

  it('tab shows the gradient once it has two colours; esc leaves without one', () => {
    const one = run(onScale(), SHIFT_RIGHT, TAB).state
    expect(one.win?.kind).toBe('gradient')
    const s = run(
      onScale(),
      SHIFT_RIGHT,
      ...typeIn('#F5A524'),
      ENTER,
      ...typeIn('#2EC4B6'),
      ENTER,
      TAB,
    ).state
    expect(s.win).toBeUndefined()
    const screen = top(s)
    expect(screen?.kind).toBe('mix')
    expect(screen?.kind === 'mix' ? screen.stops : []).toEqual([BLUE, AMBER, TEAL])
    expect(trailOf(s, ctx())).toEqual({ answers: ['#6579FD'], current: 'Gradient' })
    expect(run(onScale(), SHIFT_RIGHT, ESC).state.win).toBeUndefined()
  })

  it('↵ on a step of the gradient copies it; three colours typed with arrows make one too', () => {
    const s = run(
      onScale(),
      SHIFT_RIGHT,
      ...typeIn('#F5A524'),
      ENTER,
      ...typeIn('#2EC4B6'),
      ENTER,
      TAB,
    ).state
    const mid = gradientSteps([BLUE, AMBER, TEAL], 9, 'oklab')[4]?.hex
    expect(run(s, ENTER).effects).toEqual([{ type: 'copy', text: mid }])
    const typed = run(initial('scale'), text('#6579FD → #F5A524 → #2EC4B6'), SUBMIT).state
    const screen = top(typed)
    expect(screen?.kind === 'mix' ? screen.stops : []).toEqual([BLUE, AMBER, TEAL])
  })

  it('a gradient’s More has Steps', () => {
    const s = run(onScale(), SHIFT_RIGHT, ...typeIn('#F5A524'), ENTER, TAB, key('m')).state
    expect(moreItems(s)).toEqual(['steps'])
  })
})

describe('what a copy says', () => {
  it('says it on the key row, for three seconds', () => {
    const one = run(onScale(), ENTER).state.flash
    expect(one).toEqual({ text: 'copied #6579FD', until: 3000, keys: true })
    const all = run(onScale(), key('c')).state.flash
    expect(all).toEqual({ text: 'copied 11 swatches', until: 3000, keys: true })
  })

  it('make centre still says its own on the line under the view', () => {
    const s = run(onScale(), key('', { leftArrow: true }), key('r')).state
    expect(s.flash?.keys).toBeUndefined()
  })
})

describe('typing a colour goes on by itself when it is whole for certain (2026-10-24)', () => {
  const settled = (typed: string, from: 'scale' | 'palette' | 'system' = 'scale') =>
    run(initial(from), text(typed)).state

  it('a full 6-digit hex, with or without #: the scale, no ↵', () => {
    for (const typed of ['#6579FD', '6579fd']) {
      const s = settled(typed)
      expect(top(s), typed).toMatchObject({ kind: 'scale', ref: BLUE })
      expect(s.field.focus, typed).toBe(false)
      expect(s.preview).toBeUndefined()
    }
  })

  it('rgb(), hsl() and oklch() once the bracket closes, not before', () => {
    expect(top(settled('rgb(101 121 253)'))).toMatchObject({ kind: 'scale' })
    expect(top(settled('oklch(63% 0.196 273)'))).toMatchObject({ kind: 'scale' })
    expect(top(settled('hsl(231 98% 70%)'))).toMatchObject({ kind: 'scale' })
    const open = settled('rgb(101 121 25')
    expect(top(open)).toEqual({ kind: 'scale-empty' })
    expect(open.field.focus).toBe(true)
  })

  it('what could still grow stays in the box, drawn as it is, for ↵: shorthand and names', () => {
    for (const typed of ['#657', '#6579F', 'crimson', 'red']) {
      const s = settled(typed)
      expect(top(s), typed).toEqual({ kind: 'scale-empty' })
      expect(s.field.focus, typed).toBe(true)
    }
    expect(settled('#657').preview).toBeDefined()
    expect(run(settled('crimson'), SUBMIT).state.field.focus).toBe(false)
  })

  it('colours typed for a gradient stay in the box: there may be another', () => {
    const s = settled('#F5A524 → #6579FD')
    expect(top(s)).toEqual({ kind: 'scale-empty' })
    expect(s.field.focus).toBe(true)
    expect(top(run(s, SUBMIT).state)).toMatchObject({ kind: 'mix' })
  })

  it('on the Palette card the scale opens on its Palette tab; on Extract only a #hex goes on', () => {
    const pal = settled('#D2042D', 'system')
    expect(top(pal)).toMatchObject({ kind: 'scale' })
    expect(pal.tab).toBe('palette')
    expect(top(settled('#6579FD', 'palette'))).toMatchObject({ kind: 'scale', ref: BLUE })
    const path = settled('/tmp/6579fd', 'palette')
    expect(top(path)).toEqual({ kind: 'palette-empty' })
  })

  it('a wrong colour is not gone on from; a scale shown goes to the next whole colour typed over it', () => {
    expect(settled('#6579FG').wrong).toBeUndefined()
    expect(top(settled('#6579FG'))).toEqual({ kind: 'scale-empty' })
    const on = run(onScale(), key('#'), text('#F26E69')).state
    expect(top(on)).toMatchObject({ kind: 'scale', ref: { r: 0xf2 } })
    expect(on.history).toHaveLength(2)
  })
})
