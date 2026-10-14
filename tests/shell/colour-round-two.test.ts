import { describe, expect, it } from 'vitest'
import { NO_TWEAK } from '../../src/core/colour/system.js'
import {
  type Action,
  type ColourState,
  type Ctx,
  type Effect,
  fieldsFor,
  initial,
  type KeyLike,
  reduce,
  tabSteps,
  trailOf,
  typedPair,
} from '../../src/shell/colour/state.js'

/**
 * Colour, round two (colour spec §12): Scale's tabs, typed colours and
 * wrong input, Mix, and Palette with its Mode and Tweak windows. The
 * reducer alone; the screens' rows are held in colour-round-two-art.
 */

const ctx = (now = 0): Ctx => ({ colours: () => [], canOpen: () => false, now })
const NONE: KeyLike = {}
const key = (input: string, k: KeyLike = NONE): Action => ({ type: 'key', input, key: k })
const UP = key('', { upArrow: true })
const DOWN = key('', { downArrow: true })
const LEFT = key('', { leftArrow: true })
const RIGHT = key('', { rightArrow: true })
const SHIFT_RIGHT = key('', { rightArrow: true, shift: true })
const SHIFT_LEFT = key('', { leftArrow: true, shift: true })
const ENTER = key('', { return: true })
const ESC = key('', { escape: true })
const TAB = key('', { tab: true })
const SHIFT_TAB = key('', { tab: true, shift: true })
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
const onScale = () => initial({ scale: BLUE })

describe('Scale’s tabs (§12.1)', () => {
  it('tab goes Colour → Neutral → Alpha → Colour; shift-tab the other way', () => {
    let s = onScale()
    expect(s.tab).toBe('colour')
    s = run(s, TAB).state
    expect(s.tab).toBe('neutral')
    s = run(s, TAB).state
    expect(s.tab).toBe('alpha')
    s = run(s, TAB).state
    expect(s.tab).toBe('colour')
    expect(run(s, SHIFT_TAB).state.tab).toBe('alpha')
  })

  it('↵ copies the step as each tab shows it: the hex, the neutral’s hex, the 8-digit alpha', () => {
    const colour = run(onScale(), ENTER).effects
    expect(colour).toEqual([{ type: 'copy', text: '#6579FD' }])
    const neutral = run(onScale(), TAB, ENTER).effects
    expect(neutral).toEqual([{ type: 'copy', text: '#6D7281' }])
    const alpha = run(onScale(), TAB, TAB, ENTER).effects[0]
    expect(alpha).toMatchObject({ type: 'copy' })
    expect((alpha as { text: string }).text).toMatch(/^#[0-9A-F]{8}$/)
  })

  it('r makes a step the centre only on Colour', () => {
    const colour = run(onScale(), LEFT, key('r')).state
    expect(colour.history).toHaveLength(2)
    const neutral = run(onScale(), TAB, LEFT, key('r')).state
    expect(neutral.history).toHaveLength(1)
  })

  it('s on Neutral ends with the tint; on Alpha with the background; esc puts them back', () => {
    const n = run(onScale(), TAB, key('s')).state
    expect(fieldsFor(n).at(-1)).toBe('tint')
    const tinted = run(n, SHIFT_TAB, RIGHT).state
    expect(tinted.tint).toBe('strong')
    expect(run(tinted, ESC).state.tint).toBe('soft')
    const a = run(onScale(), TAB, TAB, key('s'), SHIFT_TAB, RIGHT).state
    expect(a.over).toBe('black')
    expect(run(a, ENTER).state).toMatchObject({ over: 'black', stepsEdit: undefined })
  })
})

describe('typing a colour (§12.4, §12.5)', () => {
  it('a scale takes rgb(), oklch() and names, not only hex', () => {
    for (const typed of ['rgb(101 121 253)', 'oklch(63% 0.196 273)', 'crimson']) {
      const { state } = run(initial('scale'), text(typed), SUBMIT)
      expect(top(state)).toMatchObject({ kind: 'scale' })
    }
  })

  it('wrong input stays in the box, marked; typing again clears the mark', () => {
    const wrong = run(initial('scale'), text('rgb(300 0 0)'), SUBMIT).state
    expect(wrong.wrong).toBe(true)
    expect(wrong.field.text).toBe('rgb(300 0 0)')
    expect(top(wrong)).toEqual({ kind: 'scale-empty' })
    expect(run(wrong, text('rgb(30 0 0)')).state.wrong).toBeUndefined()
  })

  it('on Extract a path is still a path: only a #hex is a colour', () => {
    // Typed whole, as a paste: it opens as a path, never as a colour.
    const { state, effects } = run(initial('palette'), text('crimson'), SUBMIT)
    expect(effects).toContainEqual({ type: 'open', path: 'crimson' })
    expect(state.wrong).toBeUndefined()
  })
})

describe('Mix (§12.3)', () => {
  it('reads two colours either side of an arrow, or two hexes', () => {
    expect(typedPair('#F26E69 → #6579FD')).toMatchObject({ a: { r: 0xf2 }, b: { r: 0x65 } })
    expect(typedPair('#F26E69 -> crimson')).toMatchObject({ b: { r: 0xdc } })
    expect(typedPair('#F26E69 #6579FD')).toMatchObject({ b: { r: 0x65 } })
    expect(typedPair('#F26E69 → ')).toEqual({ a: { r: 0xf2, g: 0x6e, b: 0x69 } })
    expect(typedPair('#F26E69')).toBeUndefined()
    expect(typedPair('nope → #fff')).toBeUndefined()
  })

  it('↵ on two colours mixes them on the first one’s scale; the bar says Scale ╱ Mix; esc goes back', () => {
    const { state } = run(onScale(), key('#'), text('#F26E69 → #6579FD'), SUBMIT)
    expect(top(state)).toMatchObject({ kind: 'mix', sel: 4 })
    expect(trailOf(state, ctx())).toEqual({ answers: ['#6579FD', '#F26E69'], current: 'Mix' })
    expect(top(run(state, ESC).state)).toMatchObject({ kind: 'scale', ref: { r: 0xf2 } })
  })

  it('a mix typed over another colour’s scale goes on top of its own: esc walks back through both', () => {
    const { state } = run(onScale(), key('#'), text('#F26E69 → #6579FD'), SUBMIT)
    expect(state.history.map((h) => h.kind)).toEqual(['scale', 'scale', 'mix'])
    const back = run(state, ESC, ESC).state
    expect(top(back)).toMatchObject({ kind: 'scale', ref: BLUE })
  })

  it('s changes the way across and the count; the chosen step stays as far along', () => {
    let s = run(onScale(), key('#'), text('#F26E69 → #6579FD'), SUBMIT).state
    s = run(s, key('s'), RIGHT).state
    expect(s.mixSpace).toBe('oklch')
    s = run(s, TAB, LEFT, LEFT).state
    expect(s.mixCount).toBe(7)
    expect(top(s)).toMatchObject({ sel: 3 })
    expect(run(s, ESC).state).toMatchObject({ mixSpace: 'oklab', mixCount: 9 })
  })
})

describe('Palette (§12.6)', () => {
  const RED = { r: 0xd2, g: 0x04, b: 0x2d }
  const onPalette = () => run(initial('system'), text('#D2042D'), SUBMIT).state

  it('opens empty with the box ready; a colour lands the cursor on its own cell', () => {
    expect(initial('system')).toMatchObject({ history: [{ kind: 'system-empty' }] })
    const s = onPalette()
    expect(top(s)).toEqual({ kind: 'system', ref: RED, sel: { row: 0, col: 5 } })
    expect(trailOf(s, ctx())).toEqual({ answers: [], current: 'Palette' })
  })

  it('↑↓←→ move through the grid and stop at its edges; ↵ copies the swatch', () => {
    const s = run(onPalette(), UP, LEFT, LEFT).state
    expect(top(s)).toMatchObject({ sel: { row: 0, col: 3 } })
    const far = run(onPalette(), ...Array(20).fill(DOWN), ...Array(20).fill(RIGHT)).state
    expect(top(far)).toMatchObject({ sel: { row: 8, col: 10 } })
    expect(run(onPalette(), ENTER).effects).toEqual([{ type: 'copy', text: '#D2042D' }])
    expect(run(onPalette(), key('c')).effects).toEqual([{ type: 'copy-all' }])
  })

  it('t opens Tweak on Scale too: its own, on its own scale, which it moves; esc undoes', () => {
    const plainSteps = (st: ColourState) => {
      const sc = top(st)
      return sc?.kind === 'scale' ? tabSteps(st, sc.ref, sc.tweak).map((x) => x.hex) : []
    }
    let s = run(onScale(), key('t')).state
    expect(s.win).toMatchObject({ kind: 'tweak', at: 0 })
    s = run(s, SHIFT_RIGHT, SHIFT_RIGHT).state
    expect(top(s)).toMatchObject({ kind: 'scale', tweak: { brightness: 20 } })
    // Palette's tweak is not touched.
    expect(s.tweak).toEqual(NO_TWEAK)
    const untouched = plainSteps(onScale())
    expect(plainSteps(s)).not.toEqual(untouched)
    expect(run(s, ESC).state).toMatchObject({ win: undefined })
    expect(plainSteps(run(s, ESC).state)).toEqual(untouched)
    const kept = run(s, ENTER).state
    expect(kept.win).toBeUndefined()
    expect(plainSteps(kept)).toEqual(plainSteps(s))
    // A step made the centre is the tweaked colour already: the new scale starts untweaked.
    const made = run(kept, LEFT, key('r')).state
    expect(top(made)).toMatchObject({ kind: 'scale' })
    expect((top(made) as { tweak?: unknown }).tweak).toBeUndefined()
    // esc goes back to the tweaked scale, still tweaked.
    expect(top(run(made, ESC).state)).toMatchObject({ tweak: { brightness: 20 } })
  })

  it('contrast on Scale spreads the steps from the colour, which stays', () => {
    const s = run(onScale(), key('t'), DOWN, DOWN, DOWN, SHIFT_RIGHT, SHIFT_RIGHT, ENTER).state
    const sc = top(s)
    if (sc?.kind !== 'scale') throw new Error('not a scale')
    expect(sc.tweak?.contrast).toBe(20)
    const before = tabSteps(onScale(), sc.ref)
    const after = tabSteps(s, sc.ref, sc.tweak)
    expect(after[5]?.hex).toBe(before[5]?.hex)
    expect(after[0]?.hex).not.toBe(before[0]?.hex)
  })

  it('m opens the Mode window on the mode in use; ↓ ↵ chooses, esc leaves it as it was', () => {
    const open = run(onPalette(), key('m')).state
    expect(open.win).toEqual({ kind: 'mode', at: 0 })
    const chosen = run(open, DOWN, DOWN, DOWN, ENTER).state
    expect(chosen).toMatchObject({ mode: 'opposite', win: undefined })
    // The cursor goes to the colour's own row in the new mode.
    expect(top(chosen)).toMatchObject({ sel: { row: 0 } })
    expect(run(open, DOWN, ESC).state).toMatchObject({ mode: 'full', win: undefined })
  })

  it('t opens Tweak: ←→ by 1, ⇧←→ by 10, within Photoshop’s ranges; r resets; esc undoes', () => {
    let s = run(onPalette(), key('t')).state
    expect(s.win).toMatchObject({ kind: 'tweak', at: 0 })
    s = run(s, RIGHT, SHIFT_RIGHT).state
    expect(s.tweak.brightness).toBe(11)
    s = run(s, DOWN, ...Array(20).fill(SHIFT_LEFT)).state
    expect(s.tweak.saturation).toBe(-100)
    s = run(s, DOWN, ...Array(30).fill(SHIFT_RIGHT)).state
    expect(s.tweak.hue).toBe(180)
    expect(run(s, key('r')).state.tweak).toEqual(NO_TWEAK)
    expect(run(s, ESC).state).toMatchObject({ tweak: NO_TWEAK, win: undefined })
    const kept = run(s, ENTER).state
    expect(kept.win).toBeUndefined()
    expect(kept.tweak).toMatchObject({ brightness: 11, saturation: -100, hue: 180 })
    // Once tweaked, r on the screen puts the palette back as the mode made it.
    expect(run(kept, key('r')).state.tweak).toEqual(NO_TWEAK)
  })

  it('a wrong colour on Palette is marked, as on Scale', () => {
    const { state } = run(initial('system'), text('not a colour'), SUBMIT)
    expect(state).toMatchObject({ wrong: true, history: [{ kind: 'system-empty' }] })
  })
})
