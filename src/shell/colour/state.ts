import { alphaOf, BLACK, WHITE } from '../../core/colour/alpha.js'
import { MIX_COUNTS, type MixSpace, mixSteps } from '../../core/colour/mix.js'
import { DEFAULT_TINT, neutral, type Tint } from '../../core/colour/neutral.js'
import { parseColour } from '../../core/colour/parse.js'
import {
  COUNTS,
  DEFAULT_STEPS,
  ENDS,
  placesOf,
  referenceIndex,
  SETS,
  STARTS,
  type StepSet,
  type StepSpec,
  scale,
} from '../../core/colour/scale.js'
import { parseHex, type Rgb, toHex } from '../../core/colour/space.js'
import {
  isTweaked,
  MODES,
  type Mode,
  NO_TWEAK,
  system,
  type Tweak,
  tweakSteps,
} from '../../core/colour/system.js'
import type { Trail } from '../bar-art.js'

/**
 * Colour mode's behaviour as a reducer (colour spec §6.3–6.7): which screen
 * is showing, the way back, what the field holds, and what a key does. Pure:
 * no Ink, no I/O. What it cannot compute — the colours at a drill level,
 * whether one has shades — comes in through `Ctx`; what it wants done —
 * copy, open an image, leave — goes out as `Effect`s for `ColourFlow`.
 */

export type Screen =
  | { kind: 'palette-empty' }
  | {
      kind: 'palette'
      path: string
      name: string
      meta: string
      /** The drill path: `[]` is the image's colours, `[5]` is inside the sixth. */
      level: number[]
      sel: number
    }
  | { kind: 'scale-empty' }
  | {
      kind: 'scale'
      ref: Rgb
      from?: string
      sel: number
      /** Its own Tweak window's (2026-10-14): none until one is kept. */
      tweak?: Tweak
    }
  /** Two colours mixed (colour spec §12.3), reached from a scale. */
  | { kind: 'mix'; a: Rgb; b: Rgb; sel: number }
  /** A palette from one colour (§12.6): the screen called Palette. */
  | { kind: 'system-empty' }
  | { kind: 'system'; ref: Rgb; sel: { row: number; col: number } }

/** Scale's tabs over the ramp (§12.1). */
export type ScaleTab = 'colour' | 'neutral' | 'alpha'
export const SCALE_TABS: readonly ScaleTab[] = ['colour', 'neutral', 'alpha']
export type Over = 'white' | 'black'
export const TINT_ORDER: readonly Tint[] = ['none', 'faint', 'soft', 'strong']
export const OVERS: readonly Over[] = ['white', 'black']
export const MIX_SPACES: readonly MixSpace[] = ['oklab', 'oklch']

/** The value `s` is changing on the line under the ramp, or under a mix. */
export type StepsField = 'set' | 'start' | 'end' | 'count' | 'tint' | 'over' | 'way' | 'mixCount'

/** What Palette's windows are doing (W1): choosing a mode, or moving the four sliders. */
export type PaletteWindow =
  | { kind: 'mode'; at: number }
  | { kind: 'tweak'; at: number; before: Tweak }
export const TWEAK_KEYS: readonly (keyof Tweak)[] = ['brightness', 'saturation', 'hue', 'contrast']

export interface ColourState {
  /** The way back; the last entry is on screen. */
  history: Screen[]
  field: {
    text: string
    focus: boolean
    /** What `esc` puts back. */
    before: string
  }
  /** A whole hex typed into the field on a scale: drawn at once, kept on ↵. */
  preview?: Rgb
  flash?: { text: string; until: number }
  error?: string
  /** Which steps a scale has (V1, mockups/scale-steps-2026-10.html); kept for the session. */
  steps: StepSpec
  /**
   * The steps being changed: the value in hand, and what esc puts back —
   * the steps, and the screens as they were, each scale's chosen step with them.
   */
  stepsEdit?: {
    field: StepsField
    before: StepSpec
    history: Screen[]
    /** The tab's own setting, and the mix's, as they were. */
    was: Pick<ColourState, 'tint' | 'over' | 'mixSpace' | 'mixCount'>
  }
  /** Which of Scale's tabs is showing. */
  tab: ScaleTab
  /** A neutral's tint, and an alpha's background: the last pill on the steps line. */
  tint: Tint
  over: Over
  /** How a mix goes across, and how many steps it has. */
  mixSpace: MixSpace
  mixCount: number
  /** Palette's mode and tweaks. */
  mode: Mode
  tweak: Tweak
  /** A window open over Palette's grid. */
  win?: PaletteWindow
  /** What was typed could not be read: drawn red, `wrong input` at the box's far end. */
  wrong?: boolean
}

/** The parts of Ink's `Key` this reads. */
export interface KeyLike {
  upArrow?: boolean
  downArrow?: boolean
  leftArrow?: boolean
  rightArrow?: boolean
  return?: boolean
  escape?: boolean
  tab?: boolean
  shift?: boolean
  ctrl?: boolean
  meta?: boolean
}

export type Action =
  | { type: 'key'; input: string; key: KeyLike }
  /** The field's text changed (its editor is `Prompt`). */
  | { type: 'text'; text: string }
  /** ↵ in the field. */
  | { type: 'submit' }
  | { type: 'opened'; path: string; name: string; meta: string }
  | { type: 'refused'; message: string }
  /** esc in the field's editor: cancel the edit, and any open it started. */
  | { type: 'cancel' }
  | { type: 'tick' }

export type Effect =
  | { type: 'copy'; text: string }
  /** Copy the screen's whole set as the Figma card. */
  | { type: 'copy-all' }
  /** Probe and sample this image. */
  | { type: 'open'; path: string }
  /** Leave colour, back to its home. */
  | { type: 'back' }
  /** Forget an open still running: what it finds must not land. */
  | { type: 'cancel-open' }

export interface Ctx {
  /** The hexes listed at a drill level of the open image. */
  colours: (level: number[]) => string[]
  /** Whether → can open colour `i` at `level`. */
  canOpen: (level: number[], i: number) => boolean
  now: number
}

/**
 * How the flow opens: on an empty palette or scale, on an image (opened at
 * once), on a colour, or on the scale with something already typed (`#`
 * pressed on colour's home).
 */
export type Start =
  | 'palette'
  | 'scale'
  | 'system'
  | { palette: string }
  | { scale: Rgb }
  | { typed: string }

const FLASH_MS = 1500

/** What every flow starts with besides its screens. */
const SETTINGS = {
  tab: 'colour' as ScaleTab,
  tint: DEFAULT_TINT,
  over: 'white' as Over,
  mixSpace: 'oklab' as MixSpace,
  mixCount: 9,
  mode: 'full' as Mode,
  tweak: NO_TWEAK,
}

export function initial(start: Start, steps: StepSpec = DEFAULT_STEPS): ColourState {
  const base = { ...SETTINGS, steps }
  if (start === 'palette') {
    return { ...base, history: [{ kind: 'palette-empty' }], field: field('', true) }
  }
  if (start === 'scale')
    return { ...base, history: [{ kind: 'scale-empty' }], field: field('', true) }
  if (start === 'system') {
    return { ...base, history: [{ kind: 'system-empty' }], field: field('', true) }
  }
  if ('typed' in start) {
    return {
      ...base,
      history: [{ kind: 'scale-empty' }],
      field: { text: start.typed, focus: true, before: '' },
    }
  }
  if ('palette' in start) {
    return {
      ...base,
      history: [{ kind: 'palette-empty' }],
      field: { text: start.palette, focus: true, before: '' },
    }
  }
  return {
    ...base,
    history: [{ kind: 'scale', ref: start.scale, sel: centreOf(steps) }],
    field: field(toHex(start.scale), false),
  }
}

/** Where the colour itself sits among `steps`: 500, or Radix's 9. */
export function centreOf(steps: StepSpec): number {
  return referenceIndex(steps)
}

/** What to do as the flow opens: an image handed in is opened at once. */
export function initialEffects(start: Start): Effect[] {
  return typeof start === 'object' && 'palette' in start
    ? [{ type: 'open', path: start.palette }]
    : []
}

function field(text: string, focus: boolean): ColourState['field'] {
  return { text, focus, before: text }
}

const top = (s: ColourState): Screen => s.history[s.history.length - 1] as Screen
const onPalette = (screen: Screen) => screen.kind === 'palette' || screen.kind === 'palette-empty'
const onScale = (screen: Screen) => screen.kind === 'scale' || screen.kind === 'scale-empty'
const onSystem = (screen: Screen) => screen.kind === 'system' || screen.kind === 'system-empty'

/**
 * A typed colour. On Extract only a hex with its `#`, so a path never reads
 * as one; on Scale and Palette anything `parseColour` reads (§12.4).
 */
function typedColour(screen: Screen, text: string): Rgb | undefined {
  const t = text.trim()
  if (onPalette(screen)) return t.startsWith('#') ? parseHex(t) : undefined
  return parseColour(t)?.rgb
}

/** What splits two colours typed for a mix: an arrow, or `->`, `>`. */
const MIX_ARROW = /\s*(?:→|->|>)\s*/

/**
 * Two colours typed into Scale's box, for a mix (§12.3): either side of an
 * arrow, or two hexes with a space between. `first` when only the first is
 * there yet, still waiting for the second.
 */
export function typedPair(text: string): { a: Rgb; b?: Rgb } | undefined {
  const t = text.trim()
  if (MIX_ARROW.test(t)) {
    const [left = '', right = ''] = t.split(MIX_ARROW)
    const a = parseColour(left)?.rgb
    if (!a) return undefined
    const b = right.trim() === '' ? undefined : parseColour(right)?.rgb
    return right.trim() === '' || b ? { a, ...(b ? { b } : {}) } : undefined
  }
  const parts = t.split(/\s+/)
  if (parts.length === 2 && parts.every((x) => /^#[0-9a-f]+$/i.test(x))) {
    const a = parseColour(parts[0] as string)?.rgb
    const b = parseColour(parts[1] as string)?.rgb
    return a && b ? { a, b } : undefined
  }
  return undefined
}

/**
 * The steps Scale shows on its Colour or Neutral tab (Alpha draws the Colour
 * steps), with the scale's `tweak` on them, as Palette's own row has its.
 */
export function tabSteps(s: ColourState, ref: Rgb, tweak: Tweak = NO_TWEAK) {
  const make = (r: Rgb) => (s.tab === 'neutral' ? neutral(r, s.tint, s.steps) : scale(r, s.steps))
  return isTweaked(tweak) ? tweakSteps(make, ref, tweak, centreOf(s.steps)) : make(ref)
}

/** The steps a mix shows. */
export function mixOf(s: ColourState, screen: Extract<Screen, { kind: 'mix' }>) {
  return mixSteps(screen.a, screen.b, s.mixCount, s.mixSpace)
}

/** Palette's colours: every row's steps, the neutral last. */
export function systemOf(s: ColourState, ref: Rgb) {
  return system(ref, s.mode, s.tweak, s.steps)
}

type Out = { state: ColourState; effects: Effect[] }
const same = (state: ColourState): Out => ({ state, effects: [] })

function replaceTop(s: ColourState, screen: Screen): ColourState {
  return { ...s, history: [...s.history.slice(0, -1), screen] }
}

function push(s: ColourState, screen: Screen): ColourState {
  return { ...s, history: [...s.history, screen] }
}

/** One step back, or out of colour from the first screen. */
function back(s: ColourState): Out {
  if (s.history.length <= 1) return { state: s, effects: [{ type: 'back' }] }
  const history = s.history.slice(0, -1)
  const now = history[history.length - 1] as Screen
  const text =
    now.kind === 'scale' || now.kind === 'system'
      ? toHex(now.ref)
      : now.kind === 'palette'
        ? now.path
        : ''
  return same({
    ...s,
    history,
    field: field(text, false),
    preview: undefined,
    error: undefined,
    wrong: undefined,
  })
}

function flash(s: ColourState, text: string, ctx: Ctx): ColourState {
  return { ...s, flash: { text, until: ctx.now + FLASH_MS } }
}

/** Put the field in focus with `text` typed, remembering what was there. */
function focusWith(s: ColourState, text: string): ColourState {
  return { ...s, field: { text, focus: true, before: s.field.text }, error: undefined }
}

function scaleFrom(s: ColourState, ref: Rgb, from: string | undefined): ColourState {
  const screen: Screen = { kind: 'scale', ref, sel: centreOf(s.steps), ...(from ? { from } : {}) }
  // A new colour on a mix is a scale again, in the mix's place.
  const kind = top(s).kind
  const next = kind === 'scale-empty' || kind === 'mix' ? replaceTop(s, screen) : push(s, screen)
  return {
    ...next,
    field: field(toHex(ref), false),
    preview: undefined,
    error: undefined,
    wrong: undefined,
  }
}

/** Two colours mixed: on from the scale of the first. */
function mixFrom(s: ColourState, a: Rgb, b: Rgb): ColourState {
  const screen: Screen = { kind: 'mix', a, b, sel: Math.floor(s.mixCount / 2) }
  const now = top(s)
  // The mix sits on the scale of its first colour: that one, if it is not already on screen.
  const other = now.kind === 'scale' && toHex(now.ref) !== toHex(a)
  const scaleOfA: Screen = { kind: 'scale', ref: a, sel: centreOf(s.steps) }
  const base =
    now.kind === 'scale-empty'
      ? replaceTop(s, scaleOfA)
      : other
        ? push(s, scaleOfA)
        : now.kind === 'mix'
          ? { ...s, history: s.history.slice(0, -1) }
          : s
  return {
    ...push(base, screen),
    field: field(`${toHex(a)} → ${toHex(b)}`, false),
    preview: undefined,
    error: undefined,
    wrong: undefined,
  }
}

/** A palette from `ref`, in Palette's place. */
function systemFrom(s: ColourState, ref: Rgb): ColourState {
  // The cursor starts on the colour itself, wherever its family's row is.
  const yours = Math.max(
    0,
    systemOf(s, ref).rows.findIndex((r) => r.yours),
  )
  const screen: Screen = { kind: 'system', ref, sel: { row: yours, col: centreOf(s.steps) } }
  return {
    ...replaceTop(s, screen),
    field: field(toHex(ref), false),
    preview: undefined,
    error: undefined,
    wrong: undefined,
  }
}

function onKeyWhileTyping(s: ColourState, key: KeyLike): Out {
  if (!key.escape) return same(s)
  const screen = top(s)
  const empty =
    screen.kind === 'palette-empty' ||
    screen.kind === 'scale-empty' ||
    screen.kind === 'system-empty'
  if (s.field.text === s.field.before) {
    if (empty) return back(s)
    return same({
      ...s,
      field: { ...s.field, focus: false },
      preview: undefined,
      error: undefined,
      wrong: undefined,
    })
  }
  return same({
    ...s,
    field: { text: s.field.before, focus: empty, before: s.field.before },
    preview: undefined,
    error: undefined,
    wrong: undefined,
  })
}

function onPaletteKey(
  s: ColourState,
  screen: Extract<Screen, { kind: 'palette' }>,
  input: string,
  key: KeyLike,
  ctx: Ctx,
): Out {
  const colours = ctx.colours(screen.level)
  const hex = colours[screen.sel]
  if (key.upArrow) return same(replaceTop(s, { ...screen, sel: Math.max(0, screen.sel - 1) }))
  if (key.downArrow) {
    return same(replaceTop(s, { ...screen, sel: Math.min(colours.length - 1, screen.sel + 1) }))
  }
  if (key.rightArrow) {
    if (!ctx.canOpen(screen.level, screen.sel)) return same(s)
    return same(push(s, { ...screen, level: [...screen.level, screen.sel], sel: 0 }))
  }
  if (key.leftArrow) return screen.level.length > 0 ? back(s) : same(s)
  if (key.return && hex) {
    return { state: flash(s, `copied ${hex}`, ctx), effects: [{ type: 'copy', text: hex }] }
  }
  if (input === 'c') {
    return {
      state: flash(s, `copied ${colours.length} swatches`, ctx),
      effects: [{ type: 'copy-all' }],
    }
  }
  if (input === 's' && hex) {
    const ref = parseHex(hex)
    return ref ? same(scaleFrom(s, ref, `from ${screen.name}`)) : same(s)
  }
  return same(s)
}

function onScaleKey(
  s: ColourState,
  screen: Extract<Screen, { kind: 'scale' }>,
  input: string,
  key: KeyLike,
  ctx: Ctx,
): Out {
  const steps = tabSteps(s, screen.ref, screen.tweak)
  const step = steps[screen.sel]
  const centre = centreOf(s.steps)
  if (key.tab || input === '\t') {
    const i = SCALE_TABS.indexOf(s.tab)
    const next = SCALE_TABS[(i + (key.shift ? SCALE_TABS.length - 1 : 1)) % SCALE_TABS.length]
    return same({ ...s, tab: next as ScaleTab })
  }
  if (input === 's') return same(editSteps(s, 'set'))
  // Palette's Tweak window, on this scale's own tweak.
  if (input === 't') {
    return same({ ...s, win: { kind: 'tweak', at: 0, before: screen.tweak ?? NO_TWEAK } })
  }
  // ⇧→ asks for a second colour, for a mix, as it does while the colour is
  // typed: the box opens with this one and its → (2026-10-14).
  if (key.rightArrow && key.shift) return same(focusWith(s, `${toHex(screen.ref)} → `))
  if (key.leftArrow) return same(replaceTop(s, { ...screen, sel: Math.max(0, screen.sel - 1) }))
  if (key.rightArrow) {
    return same(replaceTop(s, { ...screen, sel: Math.min(steps.length - 1, screen.sel + 1) }))
  }
  if (key.return && step) {
    // On Alpha the step is copied as its see-through 8-digit hex.
    const text =
      s.tab === 'alpha' ? alphaOf(step.rgb, s.over === 'white' ? WHITE : BLACK).hex8 : step.hex
    return { state: flash(s, `copied ${text}`, ctx), effects: [{ type: 'copy', text }] }
  }
  if (input === 'c') {
    return {
      state: flash(s, `copied ${steps.length} swatches`, ctx),
      effects: [{ type: 'copy-all' }],
    }
  }
  // Making a step the centre is the colour's own; a neutral's centre is fixed, an alpha follows its colour.
  if (input === 'r' && s.tab === 'colour' && step && screen.sel !== centre) {
    const was = `was ${step.step} of ${toHex(screen.ref)}`
    const next = push(s, { kind: 'scale', ref: step.rgb, from: was, sel: centre })
    const said = `${step.hex} is now ${steps[centre]?.step ?? 500} · esc goes back to ${toHex(screen.ref)}`
    return same(flash({ ...next, field: field(step.hex, false) }, said, ctx))
  }
  return same(s)
}

function onMixKey(
  s: ColourState,
  screen: Extract<Screen, { kind: 'mix' }>,
  input: string,
  key: KeyLike,
  ctx: Ctx,
): Out {
  const steps = mixOf(s, screen)
  const step = steps[screen.sel]
  if (input === 's') return same(editSteps(s, 'way'))
  if (key.leftArrow) return same(replaceTop(s, { ...screen, sel: Math.max(0, screen.sel - 1) }))
  if (key.rightArrow) {
    return same(replaceTop(s, { ...screen, sel: Math.min(steps.length - 1, screen.sel + 1) }))
  }
  if (key.return && step) {
    return {
      state: flash(s, `copied ${step.hex}`, ctx),
      effects: [{ type: 'copy', text: step.hex }],
    }
  }
  if (input === 'c') {
    return {
      state: flash(s, `copied ${steps.length} swatches`, ctx),
      effects: [{ type: 'copy-all' }],
    }
  }
  return same(s)
}

function onSystemKey(
  s: ColourState,
  screen: Extract<Screen, { kind: 'system' }>,
  input: string,
  key: KeyLike,
  ctx: Ctx,
): Out {
  const sys = systemOf(s, screen.ref)
  const rows = [...sys.rows.map((r) => r.steps), sys.neutral]
  const { row, col } = screen.sel
  const step = rows[row]?.[col]
  const at = (r: number, c: number) =>
    same(
      replaceTop(s, {
        ...screen,
        sel: {
          row: Math.max(0, Math.min(rows.length - 1, r)),
          col: Math.max(0, Math.min((rows[0]?.length ?? 1) - 1, c)),
        },
      }),
    )
  if (key.upArrow) return at(row - 1, col)
  if (key.downArrow) return at(row + 1, col)
  if (key.leftArrow) return at(row, col - 1)
  if (key.rightArrow) return at(row, col + 1)
  if (key.return && step) {
    return {
      state: flash(s, `copied ${step.hex}`, ctx),
      effects: [{ type: 'copy', text: step.hex }],
    }
  }
  if (input === 'c') {
    return {
      state: flash(s, `copied ${rows.length} rows of swatches`, ctx),
      effects: [{ type: 'copy-all' }],
    }
  }
  if (input === 'm') return same({ ...s, win: { kind: 'mode', at: MODES.indexOf(s.mode) } })
  if (input === 't') return same({ ...s, win: { kind: 'tweak', at: 0, before: s.tweak } })
  if (input === 's') return same(editSteps(s, 'set'))
  if (input === 'r' && isTweaked(s.tweak)) return same({ ...s, tweak: NO_TWEAK })
  return same(s)
}

/** The colour's own row in Palette's grid, for a cursor after the mode changes. */
function onYours(s: ColourState): ColourState {
  const screen = top(s)
  if (screen.kind !== 'system') return s
  const rows = systemOf(s, screen.ref).rows
  const yours = Math.max(
    0,
    rows.findIndex((r) => r.yours),
  )
  return replaceTop(s, { ...screen, sel: { ...screen.sel, row: yours } })
}

/** The tweak the Tweak window moves: the scale's own on a scale, else Palette's. */
export function tweakOf(s: ColourState): Tweak {
  const screen = top(s)
  return screen.kind === 'scale' ? (screen.tweak ?? NO_TWEAK) : s.tweak
}

/** `s` with `t` as the tweak the window moves. None on a scale is none kept. */
function withTweak(s: ColourState, t: Tweak): ColourState {
  const screen = top(s)
  if (screen.kind !== 'scale') return { ...s, tweak: t }
  const { tweak: _, ...rest } = screen
  return replaceTop(s, isTweaked(t) ? { ...rest, tweak: t } : rest)
}

/** How far each tweak reaches either way: Photoshop's ranges (§12.6). */
const REACH: Record<keyof Tweak, number> = {
  brightness: 100,
  saturation: 100,
  hue: 180,
  contrast: 100,
}

/** Keys while a window is open over Palette: the Mode list, or the Tweak sliders. */
function onWindowKey(s: ColourState, win: PaletteWindow, input: string, key: KeyLike): Out {
  if (win.kind === 'mode') {
    if (key.escape) return same({ ...s, win: undefined })
    if (key.upArrow) return same({ ...s, win: { ...win, at: Math.max(0, win.at - 1) } })
    if (key.downArrow)
      return same({ ...s, win: { ...win, at: Math.min(MODES.length - 1, win.at + 1) } })
    if (key.return) return same(onYours({ ...s, mode: MODES[win.at] as Mode, win: undefined }))
    return same(s)
  }
  // Over a scale the window moves the scale's own tweak; over Palette, Palette's.
  const now = tweakOf(s)
  const put = (t: Tweak, rest: Partial<ColourState> = {}) => same({ ...withTweak(s, t), ...rest })
  if (key.escape) return put(win.before, { win: undefined })
  if (key.return) return same({ ...s, win: undefined })
  if (key.upArrow) return same({ ...s, win: { ...win, at: Math.max(0, win.at - 1) } })
  if (key.downArrow) {
    return same({ ...s, win: { ...win, at: Math.min(TWEAK_KEYS.length - 1, win.at + 1) } })
  }
  if (input === 'r') return put(NO_TWEAK)
  if (key.leftArrow || key.rightArrow) {
    const name = TWEAK_KEYS[win.at] as keyof Tweak
    const by = (key.rightArrow ? 1 : -1) * (key.shift ? 10 : 1)
    const reach = REACH[name]
    const value = Math.max(-reach, Math.min(reach, now[name] + by))
    return put({ ...now, [name]: value })
  }
  return same(s)
}

/** The values a set lets you change, in the line's order: the set itself first. */
export function fieldsOf(set: StepSet): StepsField[] {
  if (set === 'radix') return ['set']
  if (set === 'even') return ['set', 'start', 'end', 'count']
  return ['set', 'start', 'end']
}

/**
 * What `s` changes on the screen in hand: a mix's way across and count; on
 * Scale the set's values, then the tab's own setting last (a neutral's tint,
 * an alpha's background); on Palette the set's values.
 */
export function fieldsFor(s: ColourState): StepsField[] {
  const screen = s.history[s.history.length - 1] as Screen
  if (screen.kind === 'mix') return ['way', 'mixCount']
  const set = fieldsOf(s.steps.set)
  if (screen.kind === 'scale' && s.tab === 'neutral') return [...set, 'tint']
  if (screen.kind === 'scale' && s.tab === 'alpha') return [...set, 'over']
  return set
}

/** Start changing the steps: what esc puts back is kept. */
function editSteps(s: ColourState, field: StepsField): ColourState {
  return {
    ...s,
    stepsEdit: {
      field,
      before: s.steps,
      history: s.history,
      was: { tint: s.tint, over: s.over, mixSpace: s.mixSpace, mixCount: s.mixCount },
    },
  }
}

/** One choice along a list, stopping at its ends; undefined at an end. */
function along<T>(list: readonly T[], now: T, by: 1 | -1): T | undefined {
  return list[list.indexOf(now) + by]
}
const CHOICES: Record<'start' | 'end' | 'count', readonly number[]> = {
  start: STARTS,
  end: ENDS,
  count: COUNTS,
}

/** `steps` with `field` moved one choice left or right, stopping at the ends; undefined at an end. */
function moved(steps: StepSpec, field: StepsField, by: 1 | -1): StepSpec | undefined {
  if (field !== 'set' && field !== 'start' && field !== 'end' && field !== 'count') return undefined
  if (field === 'set') {
    const i = SETS.indexOf(steps.set)
    const next = SETS[i + by]
    return next ? { ...steps, set: next } : undefined
  }
  const choices = CHOICES[field]
  const next = choices[choices.indexOf(steps[field]) + by]
  return next === undefined ? undefined : { ...steps, [field]: next }
}

/**
 * `steps` set on the state, each scale's chosen step on the number it had
 * when the editing began, or the nearest one. Always from then, not from the
 * last change, so moving a value away and back finds the same step again.
 */
function withSteps(
  s: ColourState,
  edit: NonNullable<ColourState['stepsEdit']>,
  steps: StepSpec,
): ColourState {
  // By place on the ruler, not by name: Radix's 9 and Tailwind's 500 are the same colour.
  const was = placesOf(edit.before).map((p) => p.at)
  const now = placesOf(steps).map((p) => p.at)
  const nearest = (n: number) =>
    now.reduce(
      (best, x, i) => (Math.abs(x - n) < Math.abs((now[best] as number) - n) ? i : best),
      0,
    )
  const history = edit.history.map((h) =>
    h.kind === 'scale'
      ? { ...h, sel: nearest(was[h.sel] ?? 500) }
      : h.kind === 'system'
        ? { ...h, sel: { ...h.sel, col: nearest(was[h.sel.col] ?? 500) } }
        : h,
  )
  return { ...s, steps, history }
}

/** Keys while the steps are being changed: ←→ the value, tab the next, ↵ keeps, esc undoes. */
function onStepsKey(
  s: ColourState,
  edit: NonNullable<ColourState['stepsEdit']>,
  input: string,
  key: KeyLike,
): Out {
  if (key.return) return same({ ...s, stepsEdit: undefined })
  if (key.escape) {
    return same({
      ...s,
      ...edit.was,
      steps: edit.before,
      history: edit.history,
      stepsEdit: undefined,
    })
  }
  if (key.tab || input === '\t') {
    const fields = fieldsFor(s)
    const i = fields.indexOf(edit.field)
    const next = fields[(i + (key.shift ? fields.length - 1 : 1)) % fields.length] as StepsField
    return same({ ...s, stepsEdit: { ...edit, field: next } })
  }
  if (key.leftArrow || key.rightArrow) {
    const by = key.rightArrow ? 1 : -1
    const f = edit.field
    if (f === 'tint') {
      const tint = along(TINT_ORDER, s.tint, by)
      return same(tint ? { ...s, tint } : s)
    }
    if (f === 'over') {
      const over = along(OVERS, s.over, by)
      return same(over ? { ...s, over } : s)
    }
    if (f === 'way') {
      const mixSpace = along(MIX_SPACES, s.mixSpace, by)
      return same(mixSpace ? { ...s, mixSpace } : s)
    }
    if (f === 'mixCount') {
      const mixCount = along(MIX_COUNTS, s.mixCount, by)
      if (mixCount === undefined) return same(s)
      // The chosen step stays as far along as it was.
      const history = s.history.map((h) =>
        h.kind === 'mix'
          ? { ...h, sel: Math.round((h.sel / (s.mixCount - 1)) * (mixCount - 1)) }
          : h,
      )
      return same({ ...s, mixCount, history })
    }
    const next = moved(s.steps, f, by)
    return next ? same(withSteps(s, edit, next)) : same(s)
  }
  return same(s)
}

function onKey(s: ColourState, input: string, key: KeyLike, ctx: Ctx): Out {
  if (s.field.focus) return onKeyWhileTyping(s, key)
  if (s.stepsEdit) return onStepsKey(s, s.stepsEdit, input, key)
  if (s.win) return onWindowKey(s, s.win, input, key)
  const screen = top(s)
  if (key.escape) return back(s)
  if (key.ctrl || key.meta) return same(s)

  // What starts typing: # anywhere; a path's first character, or a drop, on the palette.
  if (input === '#') return same(focusWith(s, '#'))
  if (onPalette(screen) && (input === '/' || input === '~')) return same(focusWith(s, input))
  if (input.length > 1) {
    const text = input.trim()
    const typed = focusWith(s, text)
    if (onPalette(screen) && !text.startsWith('#')) {
      return { state: typed, effects: [{ type: 'open', path: text }] }
    }
    const rgb = typedColour(screen, text)
    return same(rgb ? { ...typed, preview: rgb } : typed)
  }

  if (screen.kind === 'palette') return onPaletteKey(s, screen, input, key, ctx)
  if (screen.kind === 'scale') return onScaleKey(s, screen, input, key, ctx)
  if (screen.kind === 'mix') return onMixKey(s, screen, input, key, ctx)
  if (screen.kind === 'system') return onSystemKey(s, screen, input, key, ctx)
  return same(s)
}

export function reduce(s: ColourState, action: Action, ctx: Ctx): Out {
  switch (action.type) {
    case 'key':
      return onKey(s, action.input, action.key, ctx)
    case 'text': {
      const rgb =
        onScale(top(s)) || action.text.startsWith('#')
          ? typedColour(top(s), action.text)
          : undefined
      // A drop arrives as many characters at once: a dropped image opens by
      // itself (colour spec §6.4); a path typed a key at a time waits for ↵.
      const dropped =
        onPalette(top(s)) &&
        action.text.length - s.field.text.length > 1 &&
        !action.text.trim().startsWith('#')
      if (dropped) {
        return {
          state: {
            ...s,
            field: { ...s.field, text: action.text },
            preview: undefined,
            error: undefined,
          },
          effects: [{ type: 'open', path: action.text.trim() }],
        }
      }
      return same({
        ...s,
        field: { ...s.field, text: action.text },
        preview: onSystem(top(s)) ? undefined : rgb,
        error: undefined,
        wrong: undefined,
      })
    }
    case 'submit': {
      const text = s.field.text.trim()
      const screen = top(s)
      if (onScale(screen) || screen.kind === 'mix') {
        const pair = typedPair(text)
        if (pair?.b) return same(mixFrom(s, pair.a, pair.b))
      }
      const rgb = typedColour(screen, text)
      if (rgb && onSystem(screen)) return same(systemFrom(s, rgb))
      if (rgb) return same(scaleFrom(s, rgb, undefined))
      if (onPalette(screen) && text !== '' && !text.startsWith('#')) {
        return { state: s, effects: [{ type: 'open', path: text }] }
      }
      // Something typed that is no colour: the box says so, and keeps it.
      return same(text === '' ? s : { ...s, wrong: true, preview: undefined })
    }
    case 'opened': {
      const screen: Screen = {
        kind: 'palette',
        path: action.path,
        name: action.name,
        meta: action.meta,
        level: [],
        sel: 0,
      }
      // A new image starts the palette over; the screens before it were another image's.
      const keep = s.history.filter((h) => !onPalette(h) && h.kind !== 'scale')
      return same({
        ...s,
        history: [...keep, screen],
        field: field(action.path, false),
        error: undefined,
      })
    }
    case 'refused':
      return same({ ...s, error: action.message, field: { ...s.field, focus: true } })
    case 'cancel': {
      // Only the field's own esc sends this, and only while it has focus;
      // one that arrives after focus has gone is not a reason to leave.
      if (!s.field.focus) return same(s)
      const out = onKeyWhileTyping(s, { escape: true })
      return { state: out.state, effects: [{ type: 'cancel-open' }, ...out.effects] }
    }
    case 'tick':
      return s.flash && ctx.now >= s.flash.until ? same({ ...s, flash: undefined }) : same(s)
  }
}

/** The header bar's trail: each screen before this one, then this one. */
export function trailOf(s: ColourState, ctx: Ctx): Trail {
  const name = (screen: Screen): string => {
    if (screen.kind === 'palette' && screen.level.length > 0) {
      const parent = screen.level.slice(0, -1)
      return ctx.colours(parent)[screen.level[screen.level.length - 1] as number] ?? 'Extract'
    }
    if (onPalette(screen)) return 'Extract'
    if (screen.kind === 'mix') return 'Mix'
    if (onSystem(screen)) return 'Palette'
    return 'Scale'
  }
  const answers = s.history
    .slice(0, -1)
    .map((screen) => (screen.kind === 'scale' ? toHex(screen.ref) : name(screen)))
  return { answers, current: name(top(s)) }
}
