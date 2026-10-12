import { scale } from '../../core/colour/scale.js'
import { parseHex, type Rgb, toHex } from '../../core/colour/space.js'
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
  | { kind: 'scale'; ref: Rgb; from?: string; sel: number }

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
}

/** The parts of Ink's `Key` this reads. */
export interface KeyLike {
  upArrow?: boolean
  downArrow?: boolean
  leftArrow?: boolean
  rightArrow?: boolean
  return?: boolean
  escape?: boolean
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
  | { type: 'tick' }

export type Effect =
  | { type: 'copy'; text: string }
  /** Copy the screen's whole set as the Figma card. */
  | { type: 'copy-all' }
  /** Probe and sample this image. */
  | { type: 'open'; path: string }
  /** Leave colour, back to its home. */
  | { type: 'back' }

export interface Ctx {
  /** The hexes listed at a drill level of the open image. */
  colours: (level: number[]) => string[]
  /** Whether → can open colour `i` at `level`. */
  canOpen: (level: number[], i: number) => boolean
  now: number
}

export type Start = 'palette' | 'scale' | { palette: string } | { scale: Rgb }

const FLASH_MS = 1500

export function initial(start: Start): ColourState {
  if (start === 'palette') return { history: [{ kind: 'palette-empty' }], field: field('', true) }
  if (start === 'scale') return { history: [{ kind: 'scale-empty' }], field: field('', true) }
  if ('palette' in start) {
    return {
      history: [{ kind: 'palette-empty' }],
      field: { text: start.palette, focus: true, before: '' },
    }
  }
  return {
    history: [{ kind: 'scale', ref: start.scale, sel: 5 }],
    field: field(toHex(start.scale), false),
  }
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

/** A typed colour: on a scale with or without `#`; on the palette only with it, so a path never reads as one. */
function typedColour(screen: Screen, text: string): Rgb | undefined {
  const t = text.trim()
  if (onPalette(screen) && !t.startsWith('#')) return undefined
  return parseHex(t)
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
  const text = now.kind === 'scale' ? toHex(now.ref) : now.kind === 'palette' ? now.path : ''
  return same({ ...s, history, field: field(text, false), preview: undefined, error: undefined })
}

function flash(s: ColourState, text: string, ctx: Ctx): ColourState {
  return { ...s, flash: { text, until: ctx.now + FLASH_MS } }
}

/** Put the field in focus with `text` typed, remembering what was there. */
function focusWith(s: ColourState, text: string): ColourState {
  return { ...s, field: { text, focus: true, before: s.field.text }, error: undefined }
}

function scaleFrom(s: ColourState, ref: Rgb, from: string | undefined): ColourState {
  const screen: Screen = { kind: 'scale', ref, sel: 5, ...(from ? { from } : {}) }
  const next = top(s).kind === 'scale-empty' ? replaceTop(s, screen) : push(s, screen)
  return { ...next, field: field(toHex(ref), false), preview: undefined, error: undefined }
}

function onKeyWhileTyping(s: ColourState, key: KeyLike): Out {
  if (!key.escape) return same(s)
  const screen = top(s)
  const empty = screen.kind === 'palette-empty' || screen.kind === 'scale-empty'
  if (s.field.text === s.field.before) {
    if (empty) return back(s)
    return same({ ...s, field: { ...s.field, focus: false }, preview: undefined, error: undefined })
  }
  return same({
    ...s,
    field: { text: s.field.before, focus: empty, before: s.field.before },
    preview: undefined,
    error: undefined,
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
  const steps = scale(screen.ref)
  const step = steps[screen.sel]
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
  if (input === 'r' && step && screen.sel !== 5) {
    const was = `was ${step.step} of ${toHex(screen.ref)}`
    const next = push(s, { kind: 'scale', ref: step.rgb, from: was, sel: 5 })
    return same({ ...next, field: field(step.hex, false) })
  }
  return same(s)
}

function onKey(s: ColourState, input: string, key: KeyLike, ctx: Ctx): Out {
  if (s.field.focus) return onKeyWhileTyping(s, key)
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
      return same({
        ...s,
        field: { ...s.field, text: action.text },
        preview: rgb,
        error: undefined,
      })
    }
    case 'submit': {
      const text = s.field.text.trim()
      const rgb = typedColour(top(s), text)
      if (rgb) return same(scaleFrom(s, rgb, undefined))
      if (onPalette(top(s)) && text !== '' && !text.startsWith('#')) {
        return { state: s, effects: [{ type: 'open', path: text }] }
      }
      return same(s)
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
    case 'tick':
      return s.flash && ctx.now >= s.flash.until ? same({ ...s, flash: undefined }) : same(s)
  }
}

/** The header bar's trail: each screen before this one, then this one. */
export function trailOf(s: ColourState, ctx: Ctx): Trail {
  const name = (screen: Screen): string => {
    if (screen.kind === 'palette' && screen.level.length > 0) {
      const parent = screen.level.slice(0, -1)
      return ctx.colours(parent)[screen.level[screen.level.length - 1] as number] ?? 'Palette'
    }
    if (onPalette(screen)) return 'Palette'
    return 'Scale'
  }
  const answers = s.history
    .slice(0, -1)
    .map((screen) => (screen.kind === 'scale' ? toHex(screen.ref) : name(screen)))
  return { answers, current: name(top(s)) }
}
