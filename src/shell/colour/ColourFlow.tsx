import { Box, type DOMElement, useStdout } from 'ink'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import stringWidth from 'string-width'
import { SPINNER_FRAMES } from '../../cli/spinner.js'
import { encodePng, padToBox } from '../../core/closeup.js'
import { alphaOf, BLACK, WHITE } from '../../core/colour/alpha.js'
import {
  alphaCard,
  card,
  neutralCard,
  paletteCard,
  scaleCard,
  systemCard,
} from '../../core/colour/card.js'
import { onWhiteAndBlack } from '../../core/colour/contrast.js'
import {
  canOpen,
  type Group,
  inside,
  type Pixels,
  palette as paletteOf,
  photoMap,
  wholePercents,
} from '../../core/colour/palette.js'
import { parseColour } from '../../core/colour/parse.js'
import { DEFAULT_STEPS, type StepSpec, stepsOf } from '../../core/colour/scale.js'
import { formatOklch, formatRgb, type Rgb, toHex } from '../../core/colour/space.js'
import { isTweaked, MODE_NAMES, MODES, system } from '../../core/colour/system.js'
import { isForgeError, nothingVisible } from '../../core/errors.js'
import { formatBytes } from '../../core/units.js'
import { samplePixels } from '../../engines/pixels.js'
import { displayName } from '../../utils/display-path.js'
import { unescapePath } from '../../utils/unescape-path.js'
import type { Trail } from '../bar-art.js'
import { copy } from '../clipboard.js'
import { HintBar } from '../components/HintBar.js'
import { Runs } from '../components/Home.js'
import { Prompt } from '../components/Prompt.js'
import { fieldKey } from '../field-key.js'
import { trueColour } from '../glyphs.js'
import { sketchNoteRows } from '../halfblocks.js'
import { blank, mergeRuns, type Row, width as widthOf } from '../home-art.js'
import { imageProtocol } from '../inline-image.js'
import { easeOut, motionEnabled, useTicker, useTween } from '../motion.js'
import { isStrayEscapeSequence } from '../mouse.js'
import { Text } from '../Text.js'
import { useTheme } from '../ThemeContext.js'
import { colourProp } from '../theme.js'
import { useAfter } from '../useAfter.js'
import { useInlinePictures } from '../useInlinePictures.js'
import { useKeys } from '../useKeys.js'
import { workLine } from '../working-art.js'
import {
  alphaPreviewRows,
  alphaRampRows,
  approximateRow,
  copiedMessage,
  detailRow,
  dropZone,
  emptyRampRows,
  errorRow,
  fieldHint,
  fieldRows,
  fieldValue,
  flashRow,
  framed,
  insideColumn,
  mixLine,
  moreHintRow,
  newColourHint,
  paletteBody,
  paletteColumn,
  photoPixels,
  photoRows,
  plainPaletteRows,
  plainScaleRows,
  previewRows,
  rampRows,
  scaleTabRows,
  stepsLine,
  withKey,
} from './colour-art.js'
import {
  type Action,
  type ColourState,
  type Ctx,
  centreOf,
  type Effect,
  fieldsFor,
  initial,
  initialEffects,
  mixOf,
  moreItems,
  reduce,
  SCALE_TABS,
  type Screen,
  type Start,
  systemOf,
  TWEAK_KEYS,
  tabSteps,
  trailOf,
  tweakOf,
  typedStops,
} from './state.js'
import {
  chosenRow,
  emptyGridRows,
  GRADIENT_WINDOW_WIDTH,
  gradientLines,
  gridRows,
  MODE_WINDOW_WIDTH,
  MORE_WINDOW_WIDTH,
  modeLines,
  modeRow,
  moreLines,
  type Slider,
  TWEAK_WINDOW_WIDTH,
  tweakLines,
  windowOver,
} from './system-art.js'

/**
 * Colour mode (colour spec §6): the palette of an image and the scale of a
 * colour, as decided on the mockup's ★ Flow. `state.ts` decides what a key
 * does; this keeps the image's pixels, runs the effects (copy, open, leave)
 * and draws the rows `colour-art.ts` builds. App mounts it as the `colour`
 * step, as it mounts `PdfFlow`, and draws the header bar from `onTrail`.
 */
export interface ColourFlowProps {
  start: Start
  width: number
  height: number
  /** esc on the first screen: back to colour's home. */
  onCancel: () => void
  onTrail?: ((trail: Trail) => void) | undefined
  /** Which steps a scale has, kept by App for the session. */
  steps?: StepSpec | undefined
  /** The steps were changed and kept (↵ on the line under the ramp). */
  onSteps?: ((steps: StepSpec) => void) | undefined
}

/** What one opened image holds: its pixels, and its colours at every level opened so far. */
interface Image {
  pixels: Pixels
  levels: Map<string, Group[]>
}

const FORMATS = 'JPEG · PNG · HEIC · WebP · TIFF'
/**
 * Rows the photo needs, and the rows around the body on a colour screen: the
 * bar and its gap (2), the field (3), the line under it (1), the gap and the
 * detail (2), the approximate-colours note (1), the hints' gap, rule and keys (3).
 */
const PHOTO_ROWS = 12
const CHROME = 12
/**
 * The fewest rows the framed photo is drawn in: its frame and six rows of
 * picture. Below that the list goes alone.
 */
const MIN_PHOTO_ROWS = 8
/** The photo's widest, in cells: what it was before it had a frame. */
const PHOTO_COLS = 24

/**
 * Rows for the framed photo when the screen is `height` tall: as many as
 * fit, at most `PHOTO_ROWS`; 0 when fewer than `MIN_PHOTO_ROWS` fit. A
 * painted canvas takes a row of the window, so at 80×24 there are 11.
 * `note`: the rows the note under a photo drawn in half blocks takes.
 */
function photoRowsFor(height: number, note = 0): number {
  const fit = Math.min(PHOTO_ROWS, height - CHROME - note)
  return fit >= MIN_PHOTO_ROWS ? fit : 0
}

/** The photo and the list start four cells in; the note under a half-block photo does too. */
const LEAD = 4
const sketchNote = (p: ReturnType<typeof useTheme>, width: number): Row[] =>
  sketchNoteRows(p.dim, LEAD, width)

/**
 * The longer side `photoMap` draws the photo at, in `rows` rows framed: its
 * frame takes two, each of the rest two pixels tall. A wide photo keeps its
 * full width unless that would make it taller than the frame leaves room for.
 */
function photoMax(pixels: Pixels, rows: number): number {
  const tall = (rows - 2) * 2
  if (pixels.width < pixels.height) return tall
  return Math.min(PHOTO_COLS, Math.floor((tall * pixels.width) / pixels.height))
}

/**
 * The photo's box in cells, framed in `rows` rows: what `photoMap` draws it
 * at (its longer side `photoMax`), a cell two of its pixels tall.
 */
function photoCells(pixels: Pixels, rows: number): { cols: number; rows: number } {
  const max = photoMax(pixels, rows)
  const wide = pixels.width >= pixels.height
  const across = wide ? max : Math.max(1, Math.round((max * pixels.width) / pixels.height))
  const down = wide ? Math.max(1, Math.round((max * pixels.height) / pixels.width)) : max
  return { cols: across, rows: Math.ceil(down / 2) }
}

/** Where the picture sits in the palette's body: under its frame's top, past the four-cell lead and the frame's side. */
const PHOTO_AT = [{ row: 1, col: 5 }]

export function ColourFlow({
  start,
  width,
  height,
  onCancel,
  onTrail,
  steps = DEFAULT_STEPS,
  onSteps,
}: ColourFlowProps) {
  const p = useTheme()
  const [state, setState] = useState<ColourState>(() => initial(start, steps))
  const stateRef = useRef(state)
  stateRef.current = state
  const image = useRef<Image | null>(null)
  const openId = useRef(0)
  /**
   * An image is being read. Said only after 0.3 s, as Working is (W5): most
   * images take a tenth of that, and a line that flashes up and away is noise.
   */
  const [opening, setOpening] = useState(false)
  const finding = useAfter(opening, 300)
  const tick = useTicker(finding, 80)

  const groupsAt = (level: number[]): Group[] => {
    const img = image.current
    if (!img) return []
    const key = level.join('/')
    const known = img.levels.get(key)
    if (known) return known
    const parent = groupsAt(level.slice(0, -1))[level[level.length - 1] as number]
    const found = parent ? inside(img.pixels, parent) : []
    img.levels.set(key, found)
    return found
  }
  const opens = useRef(new Map<string, boolean>())
  const ctx = (): Ctx => ({
    colours: (level) => groupsAt(level).map((g) => g.hex),
    canOpen: (level, i) => {
      const key = `${level.join('/')}#${i}`
      const known = opens.current.get(key)
      if (known !== undefined) return known
      const g = groupsAt(level)[i]
      const can = Boolean(g && image.current && canOpen(image.current.pixels, g))
      opens.current.set(key, can)
      return can
    },
    now: Date.now(),
  })

  const run = (effects: Effect[]) => {
    for (const effect of effects) {
      if (effect.type === 'copy') copy(effect.text)
      else if (effect.type === 'copy-all') copy(cardFor(stateRef.current))
      else if (effect.type === 'back') onCancel()
      else if (effect.type === 'cancel-open') {
        openId.current++
        setOpening(false)
      } else void open(effect.path)
    }
  }
  const dispatch = (action: Action) => {
    const out = reduce(stateRef.current, action, ctx())
    stateRef.current = out.state
    setState(out.state)
    run(out.effects)
  }

  const open = async (raw: string) => {
    const id = ++openId.current
    const path = unescapePath(raw)
    setOpening(true)
    try {
      const { source, pixels } = await samplePixels(path)
      const groups = paletteOf(pixels)
      if (groups.length === 0) throw nothingVisible(path)
      if (id !== openId.current) return
      image.current = { pixels, levels: new Map([['', groups]]) }
      opens.current = new Map()
      dispatch({
        type: 'opened',
        path: raw,
        name: displayName(path),
        meta: `${source.width}×${source.height} · ${formatBytes(source.bytes)}`,
      })
    } catch (e) {
      if (id !== openId.current) return
      dispatch({ type: 'refused', message: isForgeError(e) ? e.detail : String(e) })
    } finally {
      if (id === openId.current) setOpening(false)
    }
  }

  const cardFor = (s: ColourState): string => {
    const screen = s.history[s.history.length - 1] as Screen
    const theme = p.name === 'light' ? 'light' : 'dark'
    if (screen.kind === 'palette') {
      const inside = screen.level.length > 0 ? parentOf(screen, groupsAt).hex : undefined
      return paletteCard(screen.name, groupsAt(screen.level), theme, inside)
    }
    if (screen.kind === 'scale' && s.tab === 'palette') {
      return systemCard(screen.ref, systemOf(s, screen.ref), s.mode, s.steps, theme)
    }
    if (screen.kind === 'scale') {
      // What is copied is what is shown: the scale with its tweak on.
      const shown = tabSteps(s, screen.ref, screen.tweak)
      if (s.tab === 'neutral') {
        return neutralCard(screen.ref, shown, s.tint, theme, s.steps)
      }
      if (s.tab === 'alpha') {
        const bg = s.over === 'white' ? WHITE : BLACK
        const alphas = shown.map((x) => ({
          step: x.step,
          ...alphaOf(x.rgb, bg),
        }))
        return alphaCard(screen.ref, alphas, s.over, theme, s.steps)
      }
      return scaleCard(screen.ref, shown, theme, s.steps)
    }
    if (screen.kind === 'mix') {
      const steps = mixOf(s, screen)
      return card(
        screen.stops.map(toHex).join(' to '),
        `${s.mixSpace === 'oklab' ? 'OKLab' : 'OKLCH'} · ${steps.length} steps`,
        steps.map((x) => ({ id: `mix-${x.step}`, name: `${x.step}%`, value: x.hex, hex: x.hex })),
        theme,
      )
    }
    return ''
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once, as the flow opens
  useEffect(() => run(initialEffects(start)), [])

  // A confirmation clears itself; nothing ticks while there is none.
  // biome-ignore lint/correctness/useExhaustiveDependencies: dispatch reads the latest state
  useEffect(() => {
    if (!state.flash) return
    const id = setInterval(() => dispatch({ type: 'tick' }), 250)
    return () => clearInterval(id)
  }, [state.flash])

  // Steps kept (not while they are still being changed) outlive the flow.
  const keptSteps = state.stepsEdit ? undefined : JSON.stringify(state.steps)
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the kept steps' content
  useEffect(() => {
    if (keptSteps !== undefined) onSteps?.(state.steps)
  }, [keptSteps, onSteps])

  const trail = trailOf(state, ctx())
  const trailKey = JSON.stringify(trail)
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the trail's content
  useEffect(() => {
    onTrail?.(trail)
  }, [trailKey, onTrail])

  useKeys(
    (input, key) => {
      // A mouse report or a terminal's reply is not something typed.
      if (isStrayEscapeSequence(input)) return
      dispatch({ type: 'key', input, key })
    },
    { isActive: !state.field.focus },
  )

  const screen = state.history[state.history.length - 1] as Screen
  const truecolour = useMemo(() => trueColour(), [])
  // Swatches in a 256-colour terminal are near, not exact: said once, quietly.
  // A scale has no detail of its own, so the note takes that row there, and
  // the line under the ramp still leaves the screen its height.
  const approximate = !truecolour && p.selectionBg !== ''
  // A palette coming in brings its colours up in turn (M7): only an image's
  // first palette, not a step into one of its colours or back out.
  const arriving = screen.kind === 'palette' && screen.level.length === 0 ? image.current : null
  const arrivedFor = ARRIVE_MS * useTween(arriving, ARRIVE_MS, { enabled: motionEnabled(p.name) })
  // A terminal that draws pictures (Ghostty, iTerm2) is sent the photo as
  // one, its own pixels lit and dimmed as the rows light the groups; the
  // rows leave its box blank. Everywhere else, the photo in half blocks.
  const { stdout } = useStdout()
  const protocol = stdout.isTTY && p.selectionBg !== '' ? imageProtocol() : null
  const px = image.current?.pixels
  // Without pictures the photo is drawn in half blocks, and says so under it.
  const framedRows = photoRowsFor(height, protocol === null ? sketchNote(p, width).length : 0)
  const cells =
    screen.kind === 'palette' && px && framedRows > 0 ? photoCells(px, framedRows) : undefined
  const real = protocol !== null && cells !== undefined
  const [png, setPng] = useState<Buffer | undefined>(undefined)
  const drawn = useRef(0)
  const level = screen.kind === 'palette' ? screen.level.join('/') : ''
  const lit = screen.kind === 'palette' ? screen.sel : -1
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the level and choice the photo shows, and the canvas it dims to
  useEffect(() => {
    if (!real || !px || !cells || screen.kind !== 'palette') return
    // Choices come faster than pictures are made: only the latest is shown.
    const mine = ++drawn.current
    const grid = photoPixels({
      palette: p,
      pixels: px,
      groups: groupsAt(screen.level),
      lit: screen.sel,
      inside: screen.level.length > 0,
    })
    encodePng(padToBox(grid, cells.cols, cells.rows)).then(
      (bytes) => mine === drawn.current && setPng(bytes),
      () => {},
    )
  }, [real, px, level, lit, p.canvas, cells?.cols, cells?.rows])
  // Another image: not the last one's picture while this one's is made.
  // biome-ignore lint/correctness/useExhaustiveDependencies: on a new image only
  useEffect(() => setPng(undefined), [px])
  const bodyBox = useRef<DOMElement>(null)
  const boxes = useMemo(() => [bodyBox], [])
  const pictures = useMemo(() => (real && png ? [png] : undefined), [real, png])
  useInlinePictures({
    boxes,
    pictures,
    protocol,
    cols: cells?.cols ?? 0,
    rows: cells?.rows ?? 0,
    offsets: PHOTO_AT,
  })

  const body = bodyRows({
    p,
    screen,
    state,
    groupsAt,
    width,
    height,
    real,
    pixels: px,
    arrivedFor: arriving && arrivedFor < ARRIVE_MS ? arrivedFor : undefined,
  })
  const detail = detailFor({ p, screen, state, groupsAt, width })
  const keys = keysFor(screen, state)

  // Palette with nothing dropped yet (C4): the drop zone first, the field
  // attached under it on home's recessed shelf, as home draws its own. Every
  // other screen keeps the field on top, where it names what is shown.
  const below = screen.kind === 'palette-empty'
  const fill = below && p.shelf !== '' ? p.shelf : p.selectionBg
  const field = state.field.focus ? (
    <FieldEditor
      width={width}
      fill={fill}
      value={state.field.text}
      hint={hintFor(screen)}
      wrong={state.wrong === true}
      mixes={screen.kind === 'scale' || screen.kind === 'scale-empty' || screen.kind === 'mix'}
      onChange={(text) => dispatch({ type: 'text', text })}
      onSubmit={() => dispatch({ type: 'submit' })}
      onEscape={() => dispatch({ type: 'cancel' })}
    />
  ) : (
    fieldRows({
      width,
      palette: p,
      content: restingField(p, screen, width),
      focus: false,
    })
      .map((row) => row.map((run) => (run.bg === p.selectionBg ? { ...run, bg: fill } : run)))
      .map((row, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
        <Line key={i} row={row} />
      ))
  )
  const status = (
    <Line
      row={
        state.error
          ? errorRow(p, state.error)
          : finding
            ? workLine({
                palette: p,
                mode: 'colour',
                spinner: motionEnabled(p.name)
                  ? SPINNER_FRAMES[tick % SPINNER_FRAMES.length]
                  : undefined,
                label: 'Finding colours',
                width,
              })
            : []
      }
    />
  )
  const shown = (
    <Box ref={bodyBox} flexDirection="column" flexShrink={0}>
      {body.map((row, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
        <Line key={i} row={row} />
      ))}
    </Box>
  )

  return (
    // The header bar above leaves a blank row; what comes first starts right under it.
    <Box flexDirection="column" flexGrow={1}>
      {below ? (
        <>
          {shown}
          {field}
          {status}
        </>
      ) : (
        <>
          {field}
          {/* On a full screen the empty status row is a row the tabs or the grid need. */}
          {full(screen, state) && !state.error && !finding ? null : status}
          {shown}
        </>
      )}
      {full(screen, state) ? null : <Text> </Text>}
      <Line
        row={
          state.flash && !state.flash.keys && !onPaletteTab(screen, state)
            ? flashRow(p, state.flash.text)
            : approximate && onScaleScreen(screen)
              ? approximateRow(p)
              : detail
        }
      />
      {approximate && !onScaleScreen(screen) ? <Runs row={approximateRow(p)} /> : null}
      <HintBar
        pairs={keys.main}
        foot={keys.foot}
        width={width}
        hint={moreRowFor(p, screen, state, width)}
        message={
          state.flash?.keys ? (
            <Runs row={[blank(2), ...copiedMessage(p, state.flash.text)]} />
          ) : undefined
        }
      />
    </Box>
  )
}

/**
 * The row over the key row's rule: More at the right. On the Palette tab
 * (2026-10-24) the mode's name is at its left, and while the steps are
 * being changed their line is the row, the detail line a blank above it.
 */
function moreRowFor(
  p: ReturnType<typeof useTheme>,
  screen: Screen,
  state: ColourState,
  width: number,
): ReactNode {
  const more = moreItems(state).length > 0 && !state.stepsEdit && !state.field.focus
  const palette =
    onPaletteTab(screen, state) && (screen.kind === 'scale' || state.preview !== undefined)
  if (state.win) return undefined
  if (palette && state.stepsEdit) {
    return (
      <Runs
        row={stepsLine({
          width,
          palette: p,
          spec: state.steps,
          editing: state.stepsEdit.field,
          next: fieldsFor(state).length > 1,
        })}
      />
    )
  }
  if (!more && !palette) return undefined
  const left = palette ? modeRow(p, width, MODE_NAMES[state.mode]) : []
  return <Runs row={moreHintRow({ palette: p, width, left, more })} />
}

const onScaleScreen = (screen: Screen) =>
  screen.kind === 'scale' || screen.kind === 'scale-empty' || screen.kind === 'mix'
/** The Palette tab of a scale, typed or not yet. */
const onPaletteTab = (screen: Screen, state: ColourState) =>
  state.tab === 'palette' && (screen.kind === 'scale' || screen.kind === 'scale-empty')
/** Screens whose body fills the rows the gap above the detail line would take. */
const full = (screen: Screen, _state: ColourState) => screen.kind === 'scale'

/** The field at rest: the image and its size, or the colour, its swatch and where it came from. */
function restingField(p: ReturnType<typeof useTheme>, screen: Screen, width: number): Row {
  if (screen.kind === 'palette')
    return fieldValue({ palette: p, value: screen.name, detail: screen.meta })
  if (screen.kind === 'scale') {
    const hex = toHex(screen.ref)
    const value = fieldValue({
      palette: p,
      value: hex,
      swatch: true,
      ...(screen.from ? { detail: screen.from } : {}),
    })
    return withNewColour(p, value, width)
  }
  if (screen.kind === 'mix') {
    const stops: Row = screen.stops.flatMap((c, i) => [
      ...(i ? [blank(3), { text: '→', fg: p.dim }, blank(3)] : []),
      ...fieldValue({ palette: p, value: toHex(c), swatch: true }),
    ])
    return withNewColour(p, stops, width)
  }
  return fieldHint(p, hintFor(screen))
}

/**
 * `row` with "# new colour" at the field's far end (2026-10-24), ending where
 * every field's hint ends, where it fits.
 */
function withNewColour(p: ReturnType<typeof useTheme>, row: Row, width: number): Row {
  const hint = newColourHint(p)
  const gap = width - 9 - widthOf(row) - widthOf(hint)
  return gap >= 2 ? [...row, blank(gap), ...hint] : row
}

/**
 * A key and what it does, at the field's far end, as every field's key hint
 * is drawn (`fieldKey`), in grey rather than the mode's pink: the swatches
 * already compete for attention (2026-10-16).
 */
function keyHint(p: ReturnType<typeof useTheme>, keys: string, words: string): Row {
  return fieldKey({ palette: p, key: keys, words, colour: p.border, ink: p.canvas })
}
/** While a colour is typed: ↵ is done. */
const DONE_HINT = ['↵', 'done'] as const

/** The empty box's one hint (§12.4): a colour on Scale and Palette, a path on Extract. */
const COLOUR_HINT = 'type a hex, rgb(), hsl(), oklch() or a colour name'
function hintFor(screen: Screen): string {
  return screen.kind === 'palette' || screen.kind === 'palette-empty'
    ? 'type an image path'
    : COLOUR_HINT
}

/** One row of the screen. An empty row is still a row: a blank line, not nothing. */
function Line({ row }: { row: Row }) {
  return <Runs row={row.length === 0 ? [blank(1)] : row} />
}

/**
 * Runs as nested text, for the rest of a line a `Prompt` starts: a `Box`
 * cannot sit inside the `Text` the prompt draws. (As Save as does.)
 */
function RunsText({ row }: { row: Row }) {
  return (
    <>
      {mergeRuns(row).map((run, i) => (
        <Text
          // biome-ignore lint/suspicious/noArrayIndexKey: a row's runs are positional
          key={i}
          color={colourProp(run.fg ?? '')}
          backgroundColor={colourProp(run.bg ?? '')}
          bold={run.bold ?? false}
        >
          {run.text}
        </Text>
      ))}
    </>
  )
}

/** The field while typing: the app's own editor inside the filled block. */
function FieldEditor({
  width,
  fill,
  value,
  hint,
  wrong,
  mixes,
  onChange,
  onSubmit,
  onEscape,
}: {
  width: number
  /** The field's fill: `selectionBg`, or home's shelf under the drop zone. */
  fill: string
  value: string
  hint: string
  /** What was typed is no colour (§12.4): red, `wrong input` at the far end. */
  wrong: boolean
  /** A second colour can follow the first, after →, for a mix (§12.3). */
  mixes: boolean
  onChange: (text: string) => void
  onSubmit: () => void
  onEscape: () => void
}) {
  const p = useTheme()
  const fillProps = fill === '' ? {} : { backgroundColor: colourProp(fill) }
  const typed = value.trim()
  const one = parseColour(typed)
  const stops = mixes && /→|->|>/.test(typed) ? typedStops(typed) : undefined
  const swatch = (rgb: Rgb | undefined, words = false): Row =>
    rgb
      ? [
          blank(2),
          { text: '    ', bg: toHex(rgb) },
          ...(words && !/^#?[0-9a-f]{3,8}$/i.test(typed)
            ? [blank(3), { text: toHex(rgb), fg: p.dim }]
            : []),
        ]
      : []
  // After the colour and its →: the hint for the second (approved, §12.3).
  const waiting = stops?.length === 1 && /→\s*$/.test(value)
  const last = stops && stops.length >= 2 ? stops[stops.length - 1] : undefined
  /**
   * `tail` at the far end of the field, after `before`: ending where the
   * resting field's hint ends, two cells short of the fill, not against it.
   */
  const room = width - 10 - stringWidth(value)
  const farEnd = (before: Row, tail: Row): Row => [
    ...before,
    blank(Math.max(2, room - widthOf(before) - widthOf(tail))),
    ...tail,
  ]
  // A whole colour typed, or two or more for a gradient: ↵ is done, as a grey
  // chip at the far end (asked for again 2026-10-24), where it fits.
  const done = keyHint(p, ...DONE_HINT)
  const whole = last ?? (stops === undefined ? one?.rgb : undefined)
  // A name or a function (`crimson`) says the hex beside its swatch; a gradient's last colour does not.
  const named = last === undefined
  const finished = whole !== undefined && room - widthOf(swatch(whole, named)) - widthOf(done) >= 2
  const after: Row = wrong
    ? farEnd([], [{ text: 'wrong input', fg: p.border }])
    : waiting
      ? [{ text: 'type a second colour to mix', fg: p.border }]
      : finished
        ? farEnd(swatch(whole, named), done)
        : last
          ? swatch(last)
          : swatch(one?.rgb, true)
  const pad = <Box width={width - 4} height={1} {...fillProps} />
  return (
    <Box flexDirection="column" marginLeft={2}>
      {pad}
      <Box width={width - 4} {...fillProps}>
        <Text> </Text>
        <Prompt
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          placeholder={hint}
          isActive
          variant="inline"
          after={<RunsText row={after} />}
          {...(wrong ? { valueColour: p.fail } : {})}
          width={width - 5}
          keepOnSubmit
          intercept={(_input, key, now, atEnd) => {
            // ⇧→ at the end of a whole colour asks for the second, for a mix.
            // Not → alone: on a scale that moves along the ramp, and here it
            // moves the cursor, as it always does.
            if (
              key.rightArrow &&
              key.shift &&
              atEnd &&
              mixes &&
              !/→/.test(now) &&
              parseColour(now.trim())
            ) {
              onChange(`${now.trimEnd()} → `)
              return true
            }
            if (!key.escape) return false
            onEscape()
            return true
          }}
        />
      </Box>
      {pad}
    </Box>
  )
}

/**
 * A palette's colours arriving (M7): each a step after the one above it,
 * each fading up over ARRIVE_FADE_MS; ARRIVE_MS covers a long palette.
 */
const ARRIVE_STEP_MS = 45
const ARRIVE_FADE_MS = 140
const ARRIVE_MS = 700

function bodyRows({
  p,
  screen,
  state,
  groupsAt,
  width,
  height,
  real = false,
  pixels,
  arrivedFor,
}: {
  p: ReturnType<typeof useTheme>
  screen: Screen
  state: ColourState
  groupsAt: (level: number[]) => Group[]
  width: number
  height: number
  /** The photo is drawn as a real picture over its box: the rows leave the box blank. */
  real?: boolean
  pixels: Pixels | undefined
  /** How long ago the palette came in, while its colours are still arriving (M7). */
  arrivedFor?: number | undefined
}): Row[] {
  if (screen.kind === 'palette-empty') {
    return dropZone({ width, palette: p, typing: state.field.text !== '', formats: FORMATS })
  }
  if (screen.kind === 'scale-empty' || screen.kind === 'scale') {
    const ref: Rgb | undefined = state.preview ?? (screen.kind === 'scale' ? screen.ref : undefined)
    // The Palette tab (§13): its grid where the ramp would be.
    if (state.tab === 'palette') return paletteTabRows({ p, screen, state, ref, width, height })
    if (!ref) return emptyRampRows({ width, palette: p, steps: stepsOf(state.steps) })
    // A colour being typed is drawn as it is; a shown scale with its own tweak.
    const tweak = screen.kind === 'scale' && !state.preview ? screen.tweak : undefined
    const steps = tabSteps(state, ref, tweak)
    const centre = centreOf(state.steps)
    const sel = screen.kind === 'scale' && !state.preview ? screen.sel : centre
    const step = steps[sel] ?? steps[centre]
    if (!step) return []
    const tabbed = screen.kind === 'scale'
    const extra =
      state.tab === 'neutral'
        ? { field: 'tint' as const, value: state.tint }
        : state.tab === 'alpha'
          ? { field: 'over' as const, value: state.over }
          : undefined
    const line: Row = tabbed
      ? stepsLine({
          width,
          palette: p,
          spec: state.steps,
          editing: state.stepsEdit?.field,
          next: fieldsFor(state).length > 1,
          extra,
        })
      : []
    // A blank row between the field and the tabs where the window has one to
    // spare: at 80×24 every row is taken, and the tabs sit right under the field.
    const gap: Row[] = height > TIGHT_HEIGHT ? [[]] : []
    const tabs = tabbed
      ? [
          ...gap,
          ...scaleTabRows({
            width,
            palette: p,
            at: SCALE_TABS.indexOf(state.tab),
            cap: !state.stepsEdit,
          }),
        ]
      : []
    const bg = state.over === 'white' ? WHITE : BLACK
    // Without colour there are no swatches to look at: the scale as text.
    if (p.selectionBg === '') {
      const rows = steps.map((x) => ({
        ...x,
        ...(state.tab === 'alpha' ? { hex: alphaOf(x.rgb, bg).hex8 } : {}),
        ...onWhiteAndBlack(x.rgb),
      }))
      const plain = plainScaleRows({ palette: p, steps: rows, selected: sel })
      if (!tabbed) return plain
      return [...tabs, ...plain, [], line]
    }
    if (tabbed && state.tab === 'alpha') {
      const alphas = steps.map((x) => alphaOf(x.rgb, bg))
      const body: Row[] = [
        ...tabs,
        ...alphaRampRows({ width, palette: p, steps, alphas, selected: sel, over: state.over }),
        line,
        [],
        ...alphaPreviewRows({
          palette: p,
          step: step.step,
          alpha: alphas[sel] ?? alphaOf(step.rgb, bg),
          over: state.over,
        }),
      ]
      return state.win ? windowFor(p, state, ref, body, width) : body
    }
    const reads = onWhiteAndBlack(step.rgb)
    // The steps' line sits right under the ramp it describes, in the row a
    // gap took before it, so the screen is no taller than it was.
    const body: Row[] = [
      ...tabs,
      ...rampRows({ width, palette: p, steps, selected: sel }),
      line,
      [],
      ...previewRows({ palette: p, step: { ...step, oklch: formatOklch(step.rgb), ...reads } }),
    ]
    return state.win ? windowFor(p, state, ref, body, width) : body
  }
  if (screen.kind === 'mix') {
    const steps = mixOf(state, screen)
    const step = steps[screen.sel] ?? steps[0]
    if (!step) return []
    const edit = state.stepsEdit?.field
    const line = mixLine({
      width,
      palette: p,
      space: state.mixSpace,
      count: state.mixCount,
      editing: edit === 'way' || edit === 'mixCount' ? edit : undefined,
    })
    if (p.selectionBg === '') {
      const rows = steps.map((x) => ({ ...x, ...onWhiteAndBlack(x.rgb) }))
      return [...plainScaleRows({ palette: p, steps: rows, selected: screen.sel }), [], line]
    }
    const reads = onWhiteAndBlack(step.rgb)
    const preview = previewRows({
      palette: p,
      step: { ...step, oklch: formatOklch(step.rgb), ...reads },
    })
    // How far along, not a step's name: "50%".
    const first = preview[0]
    const at = first?.findIndex((r) => r.text === String(step.step) && r.bold) ?? -1
    if (first && at >= 0)
      first[at] = { ...(first[at] as (typeof first)[number]), text: `${step.step}%` }
    const body = [
      ...rampRows({ width, palette: p, steps, selected: screen.sel }),
      line,
      [],
      ...preview,
    ]
    return state.win ? windowFor(p, state, steps[0]?.rgb ?? step.rgb, body, width) : body
  }
  // The palette, or inside one of its colours.
  const groups = groupsAt(screen.level)
  const pcts = wholePercents(groups.map((g) => g.share))
  const items = groups.map((g, i) => ({ hex: g.hex, pct: pcts[i] as number }))
  // Without colour, no photo and no swatches: the palette as text.
  if (p.selectionBg === '') {
    return plainPaletteRows({ palette: p, items, selected: screen.sel })
  }
  const note = real ? [] : sketchNote(p, width)
  const framedRows = photoRowsFor(height, note.length)
  const showPhoto = framedRows > 0
  const column =
    screen.level.length === 0
      ? paletteColumn({
          palette: p,
          items,
          selected: screen.sel,
          rows: showPhoto ? framedRows : items.length,
          arrive:
            arrivedFor === undefined
              ? undefined
              : items.map((_, i) => easeOut((arrivedFor - i * ARRIVE_STEP_MS) / ARRIVE_FADE_MS)),
        })
      : insideColumn({
          palette: p,
          parent: parentOf(screen, groupsAt),
          items,
          selected: screen.sel,
          rows: showPhoto ? framedRows : items.length + 2,
        })
  if (!showPhoto || !pixels) return column.map((row) => [blank(LEAD), ...row])
  const photo = real
    ? (() => {
        const box = photoCells(pixels, framedRows)
        return Array.from({ length: box.rows }, (): Row => [blank(box.cols)])
      })()
    : photoFor(p, screen, groupsAt, pixels, framedRows)
  return [...paletteBody(framed(p, photo), column), ...note]
}

/** The colour a drill level is inside: its hex, its whole percentage, and its share of the image. */
function parentOf(
  screen: Extract<Screen, { kind: 'palette' }>,
  groupsAt: (level: number[]) => Group[],
): { hex: string; pct: number; ofImage: number } {
  const up = screen.level.slice(0, -1)
  const at = screen.level[screen.level.length - 1] as number
  const siblings = groupsAt(up)
  const pcts = wholePercents(siblings.map((g) => g.share))
  // Its share of the whole image: the product of the shares on the way down.
  let ofImage = 1
  for (let d = 0; d < screen.level.length; d++) {
    ofImage *= groupsAt(screen.level.slice(0, d))[screen.level[d] as number]?.share ?? 0
  }
  return { hex: siblings[at]?.hex ?? '', pct: pcts[at] ?? 0, ofImage }
}

/** The photo in the colours of the level on screen; inside a colour, the rest of it faint. */
function photoFor(
  p: ReturnType<typeof useTheme>,
  screen: Extract<Screen, { kind: 'palette' }>,
  groupsAt: (level: number[]) => Group[],
  pixels: Pixels,
  /** The rows the framed photo has. */
  rows: number,
): Row[] {
  const here = groupsAt(screen.level)
  const max = photoMax(pixels, rows)
  const map = photoMap(pixels, here, max)
  if (screen.level.length === 0) {
    return photoRows({ palette: p, map, colours: here.map((g) => g.hex), lit: screen.sel })
  }
  const top = groupsAt([])
  return photoRows({
    palette: p,
    map,
    colours: here.map((g) => g.hex),
    lit: screen.sel,
    outside: { map: photoMap(pixels, top, max), colours: top.map((g) => g.hex) },
  })
}

/**
 * The Palette tab (§12.6, §13): the tabs, the chosen swatch, the grid of a
 * palette from the colour, and the mode's name under it; before a colour,
 * the grid's outline. Windows open over it.
 */
function paletteTabRows({
  p,
  screen,
  state,
  ref,
  width,
  height,
}: {
  p: ReturnType<typeof useTheme>
  screen: Extract<Screen, { kind: 'scale' | 'scale-empty' }>
  state: ColourState
  ref: Rgb | undefined
  width: number
  height: number
}): Row[] {
  const labels = stepsOf(state.steps).map(String)
  const gap: Row[] = height > TIGHT_HEIGHT ? [[]] : []
  const tabs =
    screen.kind === 'scale'
      ? [
          ...gap,
          ...scaleTabRows({
            width,
            palette: p,
            at: SCALE_TABS.indexOf(state.tab),
            cap: !state.stepsEdit,
          }),
        ]
      : []
  if (!ref) {
    const lines = paletteLinesFor(height, tabs.length)
    return [[], [], ...emptyGridRows({ width, palette: p, labels, lines })]
  }
  const sys = systemOf(state, ref)
  const rows = [
    ...sys.rows.map((r) => ({ name: r.name, hexes: r.steps.map((x) => x.hex), yours: r.yours })),
    { name: 'neutral', hexes: sys.neutral.map((x) => x.hex), yours: false },
  ]
  // The mode's line is on More's row now (2026-10-24), under the detail
  // line, and the row it took is the blank under the chosen swatch; the
  // blank goes when keeping it would make the grid scroll.
  const most = paletteLinesFor(height, tabs.length) + 1
  const spaced = most - 1 >= rows.length
  const lines = spaced ? most - 1 : most
  const gap2: Row[] = spaced ? [[]] : []
  const steps = [...sys.rows.map((r) => r.steps), sys.neutral]
  const centre = centreOf(state.steps)
  const yours = Math.max(
    0,
    rows.findIndex((r) => r.yours),
  )
  const cell = screen.kind === 'scale' && !state.preview ? screen.cell : { row: yours, col: centre }
  const chosen = steps[cell.row]?.[cell.col]
  const top: Row =
    state.flash && !state.flash.keys
      ? flashRow(p, state.flash.text)
      : chosen
        ? chosenRow(
            p,
            rows[cell.row]?.name ?? '',
            labels[cell.col] ?? '',
            chosen.hex,
            formatOklch(chosen.rgb),
          )
        : []
  if (p.selectionBg === '') {
    const picked = (steps[cell.row] ?? []).map((x) => ({ ...x, ...onWhiteAndBlack(x.rgb) }))
    return [
      ...tabs,
      top,
      ...gap2,
      ...plainScaleRows({ palette: p, steps: picked, selected: cell.col }),
    ]
  }
  const grid = gridRows({
    width,
    palette: p,
    labels,
    rows,
    reference: centre,
    sel: cell,
    framed: !state.win,
    lines,
  })
  const body: Row[] = [...tabs, top, ...gap2, ...grid]
  return state.win ? windowFor(p, state, ref, body, width) : body
}

function detailFor({
  p,
  screen,
  groupsAt,
  width,
}: {
  p: ReturnType<typeof useTheme>
  screen: Screen
  state: ColourState
  groupsAt: (level: number[]) => Group[]
  width: number
}): Row {
  if (screen.kind !== 'palette') return []
  const groups = groupsAt(screen.level)
  const g = groups[screen.sel]
  if (!g) return []
  // At the top, → goes into the chosen colour: said beside it, not in the key row.
  if (screen.level.length === 0) {
    const values = detailRow(p, [
      { text: g.hex, strong: true },
      { text: formatRgb(g.rgb) },
      { text: formatOklch(g.rgb) },
    ])
    return withKey(p, values, '→', 'go deeper', width)
  }
  const parent = parentOf(screen, groupsAt)
  const pct = wholePercents(groups.map((x) => x.share))[screen.sel] ?? 0
  const ofImage = (g.share * parent.ofImage * 100).toFixed(1)
  return detailRow(p, [
    { text: g.hex, strong: true },
    { text: `${pct}% of ${parent.hex}` },
    { text: ` · ${ofImage}% of the image`, quiet: true, joined: true },
  ])
}

function keysFor(
  screen: Screen,
  state: ColourState,
): { main: Array<[string, string]>; foot: Array<[string, string]> } {
  if (state.field.focus) {
    return onScaleScreen(screen)
      ? {
          main: [
            ['↵', 'done'],
            ['esc', 'cancel'],
          ],
          foot: [['ctrl-c', 'quit']],
        }
      : {
          main: [['↵', 'open']],
          foot: [
            ['esc', 'back'],
            ['ctrl-c', 'quit'],
          ],
        }
  }
  if (screen.kind === 'palette' && screen.level.length > 0) {
    return {
      main: [
        ['↑↓', 'choose'],
        ['←', 'back'],
        ['↵', 'copy'],
        ['c', 'copy all'],
      ],
      foot: [
        ['esc', 'back'],
        ['ctrl-c', 'quit'],
      ],
    }
  }
  if (screen.kind === 'palette') {
    return {
      main: [
        ['↑↓', 'choose'],
        ['↵', 'copy'],
        ['c', 'copy all'],
      ],
      foot: [
        ['s', 'scale'],
        ['#', 'new colour'],
        ['esc', 'back'],
        ['ctrl-c', 'quit'],
      ],
    }
  }
  // A window has the key row while it is open.
  if (state.win?.kind === 'more') {
    return {
      main: [
        ['↑↓', 'choose'],
        ['↵', 'open'],
        ['m', 'done'],
      ],
      foot: [
        ['esc', 'close'],
        ['ctrl-c', 'quit'],
      ],
    }
  }
  if (state.win?.kind === 'gradient') {
    return {
      main: [
        ['↵', 'add'],
        ['↑↓', 'choose'],
      ],
      foot: [
        ['⌫', 'remove'],
        ['tab', 'done'],
        ['esc', 'cancel'],
      ],
    }
  }
  if (state.win?.kind === 'mode') {
    return {
      main: [
        ['↑↓', 'choose'],
        ['↵', 'done'],
      ],
      foot: [
        ['esc', 'cancel'],
        ['ctrl-c', 'quit'],
      ],
    }
  }
  if (state.win?.kind === 'tweak') {
    return {
      main: [
        ['↑↓', 'choose'],
        ['←→', '1'],
        ['⇧←→', '10'],
        ['↵', 'done'],
      ],
      foot: [
        ['r', 'reset'],
        ['esc', 'cancel'],
      ],
    }
  }
  // The steps being changed: tab next and ↵ done sit on their line (2026-10-24).
  if (state.stepsEdit) {
    return {
      main: [['←→', 'change']],
      foot: [
        ['esc', 'cancel'],
        ['ctrl-c', 'quit'],
      ],
    }
  }
  // # new colour is at the field's far end now (2026-10-24); esc back on every one.
  if (screen.kind === 'scale' && state.tab === 'palette') {
    return {
      main: [
        ['↑↓←→', 'choose'],
        ['↵', 'copy'],
        ['c', 'copy all'],
      ],
      foot: isTweaked(state.tweak)
        ? [
            ['r', 'reset'],
            ['esc', 'back'],
          ]
        : [['esc', 'back']],
    }
  }
  return {
    main: [
      ['←→', 'choose'],
      ['↵', 'copy'],
      ['c', 'copy all'],
    ],
    // Making a step the centre is the Colour tab's own, and a scale's.
    foot:
      screen.kind === 'scale' && state.tab === 'colour'
        ? [
            ['r', 'make centre'],
            ['esc', 'back'],
          ]
        : [['esc', 'back']],
  }
}

/** The rows a screen has at 80×24 (the window less the painted canvas's): Scale's every one taken. */
const TIGHT_HEIGHT = 23

/**
 * The lines Palette's grid may take under its step numbers (§12.6): what
 * the screen leaves it, nine at 80×24.
 */
const GRID_LINES = 9
/**
 * The most lines the Palette tab's grid can have under its step numbers: the
 * bar, the field, the tabs, the chosen swatch's line, the mode's line, the
 * detail line and the key rows take the rest. At least three.
 */
const paletteLinesFor = (height: number, tabRows: number) =>
  Math.max(3, Math.min(GRID_LINES + 6, height - 12 - tabRows))

/** Palette's open window (W1), drawn over its body: the Mode list, or the Tweak sliders. */
function windowFor(
  p: ReturnType<typeof useTheme>,
  state: ColourState,
  ref: Rgb,
  body: Row[],
  width: number,
): Row[] {
  const win = state.win
  if (!win) return body
  const centred = (lines: Row[]) => Math.max(1, Math.floor((body.length - lines.length - 2) / 2))
  if (win.kind === 'more') {
    const lines = moreLines(p, moreItems(state), win.at)
    return windowOver(p, body, {
      title: 'More',
      lines,
      width: MORE_WINDOW_WIDTH,
      columns: width,
      top: centred(lines),
    })
  }
  if (win.kind === 'gradient') {
    const lines = gradientLines(p, win)
    return windowOver(p, body, {
      title: 'Gradient',
      lines,
      width: GRADIENT_WINDOW_WIDTH,
      columns: width,
      top: centred(lines),
    })
  }
  const chipsOf = (sys: ReturnType<typeof systemOf>) => [
    ...sys.rows.map((r) => r.steps[centreOf(state.steps)]?.hex ?? '#000000'),
    sys.neutral[centreOf(state.steps)]?.hex ?? '#000000',
  ]
  if (win.kind === 'mode') {
    const modes = MODES.map((m) => ({
      name: MODE_NAMES[m],
      hexes: chipsOf(system(ref, m, state.tweak, state.steps)),
    }))
    // As many modes as fit over the body; the rest scroll.
    const room = Math.max(3, body.length - 4)
    const visible = Math.min(MODES.length, room)
    const first = Math.max(0, Math.min(win.at - visible + 1, MODES.length - visible))
    const lines = modeLines(p, modes, win.at, first, visible)
    return windowOver(p, body, {
      title: 'Mode',
      lines,
      width: MODE_WINDOW_WIDTH,
      columns: width,
      top: Math.max(1, body.length - lines.length - 3),
      scroll: visible < MODES.length ? { at: first, of: MODES.length } : undefined,
    })
  }
  // Over a scale, its own tweak, and its steps as the strip that moves with it.
  const tweak = tweakOf(state)
  const screen = state.history[state.history.length - 1] as Screen
  const sliders: Slider[] = TWEAK_KEYS.map((k) => ({
    label: k,
    value: tweak[k],
    max: k === 'hue' ? 180 : 100,
    unit: k === 'hue' ? '°' : '',
  }))
  const strip =
    screen.kind === 'scale' && state.tab !== 'palette'
      ? tabSteps(state, ref, tweak).map((x) => x.hex)
      : chipsOf(systemOf(state, ref))
  const lines = tweakLines(p, sliders, win.at, strip)
  return windowOver(p, body, {
    title: 'Tweak',
    lines,
    width: TWEAK_WINDOW_WIDTH,
    columns: width,
    top: Math.max(1, body.length - lines.length - 3),
  })
}
