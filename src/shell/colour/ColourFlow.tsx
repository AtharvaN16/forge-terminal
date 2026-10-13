import { Box } from 'ink'
import { useEffect, useMemo, useRef, useState } from 'react'
import { SPINNER_FRAMES } from '../../cli/spinner.js'
import { paletteCard, scaleCard } from '../../core/colour/card.js'
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
import { DEFAULT_STEPS, type StepSpec, scale, stepsOf } from '../../core/colour/scale.js'
import { formatOklch, formatRgb, type Rgb, toHex } from '../../core/colour/space.js'
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
import { trueColour } from '../glyphs.js'
import { blank, type Row } from '../home-art.js'
import { easeOut, motionEnabled, useTicker, useTween } from '../motion.js'
import { isStrayEscapeSequence } from '../mouse.js'
import { Text } from '../Text.js'
import { useTheme } from '../ThemeContext.js'
import { colourProp } from '../theme.js'
import { useAfter } from '../useAfter.js'
import { useKeys } from '../useKeys.js'
import { workLine } from '../working-art.js'
import {
  approximateRow,
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
  paletteBody,
  paletteColumn,
  photoRows,
  plainPaletteRows,
  plainScaleRows,
  previewRows,
  rampRows,
  stepsLine,
  withKey,
} from './colour-art.js'
import {
  type Action,
  type ColourState,
  type Ctx,
  centreOf,
  type Effect,
  fieldsOf,
  initial,
  initialEffects,
  reduce,
  type Screen,
  type Start,
  trailOf,
} from './state.js'

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
 */
function photoRowsFor(height: number): number {
  const fit = Math.min(PHOTO_ROWS, height - CHROME)
  return fit >= MIN_PHOTO_ROWS ? fit : 0
}

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
    if (screen.kind === 'scale') {
      return scaleCard(screen.ref, scale(screen.ref, s.steps), theme, s.steps)
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
  const body = bodyRows({
    p,
    screen,
    state,
    groupsAt,
    width,
    height,
    pixels: image.current?.pixels,
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
      hint={onScaleScreen(screen) ? 'type a hex code' : 'type an image path'}
      onChange={(text) => dispatch({ type: 'text', text })}
      onSubmit={() => dispatch({ type: 'submit' })}
      onEscape={() => dispatch({ type: 'cancel' })}
    />
  ) : (
    fieldRows({
      width,
      palette: p,
      content: restingField(p, screen),
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
  const shown = body.map((row, i) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
    <Line key={i} row={row} />
  ))

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
          {status}
          {shown}
        </>
      )}
      <Text> </Text>
      <Line
        row={
          state.flash
            ? flashRow(p, state.flash.text)
            : approximate && onScaleScreen(screen)
              ? approximateRow(p)
              : detail
        }
      />
      {approximate && !onScaleScreen(screen) ? <Runs row={approximateRow(p)} /> : null}
      <HintBar pairs={keys.main} foot={keys.foot} width={width} />
    </Box>
  )
}

const onScaleScreen = (screen: Screen) => screen.kind === 'scale' || screen.kind === 'scale-empty'

/** The field at rest: the image and its size, or the colour, its swatch and where it came from. */
function restingField(p: ReturnType<typeof useTheme>, screen: Screen): Row {
  if (screen.kind === 'palette')
    return fieldValue({ palette: p, value: screen.name, detail: screen.meta })
  if (screen.kind === 'scale') {
    const hex = toHex(screen.ref)
    return fieldValue({
      palette: p,
      value: hex,
      swatch: true,
      ...(screen.from ? { detail: screen.from } : {}),
    })
  }
  return fieldHint(p, onScaleScreen(screen) ? 'type a hex code' : 'type an image path')
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
      {row.map((run, i) => (
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
  onChange,
  onSubmit,
  onEscape,
}: {
  width: number
  /** The field's fill: `selectionBg`, or home's shelf under the drop zone. */
  fill: string
  value: string
  hint: string
  onChange: (text: string) => void
  onSubmit: () => void
  onEscape: () => void
}) {
  const fillProps = fill === '' ? {} : { backgroundColor: colourProp(fill) }
  const swatch: Row = /^#[0-9a-f]{6}$/i.test(value.trim())
    ? [blank(2), { text: '    ', bg: value.trim() }]
    : []
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
          after={<RunsText row={swatch} />}
          width={width - 5}
          intercept={(_input, key) => {
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
  pixels,
  arrivedFor,
}: {
  p: ReturnType<typeof useTheme>
  screen: Screen
  state: ColourState
  groupsAt: (level: number[]) => Group[]
  width: number
  height: number
  pixels: Pixels | undefined
  /** How long ago the palette came in, while its colours are still arriving (M7). */
  arrivedFor?: number | undefined
}): Row[] {
  if (screen.kind === 'palette-empty') {
    return dropZone({ width, palette: p, typing: state.field.text !== '', formats: FORMATS })
  }
  if (screen.kind === 'scale-empty' || screen.kind === 'scale') {
    const ref: Rgb | undefined = state.preview ?? (screen.kind === 'scale' ? screen.ref : undefined)
    if (!ref) return emptyRampRows({ width, palette: p, steps: stepsOf(state.steps) })
    const steps = scale(ref, state.steps)
    const centre = centreOf(state.steps)
    const sel = screen.kind === 'scale' && !state.preview ? screen.sel : centre
    const step = steps[sel] ?? steps[centre]
    if (!step) return []
    // Without colour there are no swatches to look at: the scale as text.
    if (p.selectionBg === '') {
      const rows = steps.map((x) => ({ ...x, ...onWhiteAndBlack(x.rgb) }))
      const plain = plainScaleRows({ palette: p, steps: rows, selected: sel })
      if (screen.kind !== 'scale') return plain
      const line = stepsLine({
        width,
        palette: p,
        spec: state.steps,
        editing: state.stepsEdit?.field,
      })
      return [...plain, [], line]
    }
    const reads = onWhiteAndBlack(step.rgb)
    // The steps' line sits right under the ramp it describes, in the row a
    // gap took before it, so the screen is no taller than it was.
    const line: Row =
      screen.kind === 'scale'
        ? stepsLine({ width, palette: p, spec: state.steps, editing: state.stepsEdit?.field })
        : []
    return [
      ...rampRows({ width, palette: p, steps, selected: sel }),
      line,
      [],
      ...previewRows({ palette: p, step: { ...step, oklch: formatOklch(step.rgb), ...reads } }),
    ]
  }
  // The palette, or inside one of its colours.
  const groups = groupsAt(screen.level)
  const pcts = wholePercents(groups.map((g) => g.share))
  const items = groups.map((g, i) => ({ hex: g.hex, pct: pcts[i] as number }))
  // Without colour, no photo and no swatches: the palette as text.
  if (p.selectionBg === '') {
    return plainPaletteRows({ palette: p, items, selected: screen.sel })
  }
  const framedRows = photoRowsFor(height)
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
  if (!showPhoto || !pixels) return column.map((row) => [blank(4), ...row])
  return paletteBody(framed(p, photoFor(p, screen, groupsAt, pixels, framedRows)), column)
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
  // The steps being changed: ↵ done sits on their line, where s steps was.
  // Radix has nothing but the set to change, so nothing to tab to.
  if (state.stepsEdit) {
    const more = fieldsOf(state.steps.set).length > 1
    return {
      main: [['←→', 'change'], ...(more ? [['tab', 'next'] as [string, string]] : [])],
      foot: [
        ['esc', 'cancel'],
        ['ctrl-c', 'quit'],
      ],
    }
  }
  return {
    main: [
      ['←→', 'choose'],
      ['↵', 'copy'],
      ['c', 'copy all'],
    ],
    foot: [
      ['r', 'make centre'],
      ['#', 'new colour'],
      ['esc', 'back'],
    ],
  }
}
