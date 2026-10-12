import { basename } from 'node:path'
import { Box, Text } from 'ink'
import { useEffect, useMemo, useRef, useState } from 'react'
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
import { scale } from '../../core/colour/scale.js'
import { formatOklch, formatRgb, type Rgb } from '../../core/colour/space.js'
import { isForgeError, nothingVisible } from '../../core/errors.js'
import { formatBytes } from '../../core/units.js'
import { samplePixels } from '../../engines/pixels.js'
import { unescapePath } from '../../utils/unescape-path.js'
import type { Trail } from '../bar-art.js'
import { copy } from '../clipboard.js'
import { HintBar } from '../components/HintBar.js'
import { Runs } from '../components/Home.js'
import { Prompt } from '../components/Prompt.js'
import { trueColour } from '../glyphs.js'
import { blank, type Row } from '../home-art.js'
import { useTheme } from '../ThemeContext.js'
import { colourProp } from '../theme.js'
import { useKeys } from '../useKeys.js'
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
  insideColumn,
  paletteBody,
  paletteColumn,
  photoRows,
  previewRows,
  rampRows,
} from './colour-art.js'
import {
  type Action,
  type ColourState,
  type Ctx,
  type Effect,
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
}

/** What one opened image holds: its pixels, and its colours at every level opened so far. */
interface Image {
  pixels: Pixels
  levels: Map<string, Group[]>
}

const FORMATS = 'JPEG · PNG · HEIC · WebP · TIFF'
/** Rows the photo needs, and the rows around the body on a colour screen. */
const PHOTO_ROWS = 12
const CHROME = 12

export function ColourFlow({ start, width, height, onCancel, onTrail }: ColourFlowProps) {
  const p = useTheme()
  const [state, setState] = useState<ColourState>(() => initial(start))
  const stateRef = useRef(state)
  stateRef.current = state
  const image = useRef<Image | null>(null)
  const openId = useRef(0)

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
      else void open(effect.path)
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
        name: basename(path),
        meta: `${source.width}×${source.height} · ${formatBytes(source.bytes)}`,
      })
    } catch (e) {
      if (id !== openId.current) return
      dispatch({ type: 'refused', message: isForgeError(e) ? e.detail : String(e) })
    }
  }

  const cardFor = (s: ColourState): string => {
    const screen = s.history[s.history.length - 1] as Screen
    const theme = p.name === 'light' ? 'light' : 'dark'
    if (screen.kind === 'palette') return paletteCard(screen.name, groupsAt(screen.level), theme)
    if (screen.kind === 'scale') return scaleCard(screen.ref, scale(screen.ref), theme)
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

  const trail = trailOf(state, ctx())
  const trailKey = JSON.stringify(trail)
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the trail's content
  useEffect(() => {
    onTrail?.(trail)
  }, [trailKey, onTrail])

  useKeys((input, key) => dispatch({ type: 'key', input, key }), { isActive: !state.field.focus })

  const screen = state.history[state.history.length - 1] as Screen
  const truecolour = useMemo(() => trueColour(), [])
  const body = bodyRows({
    p,
    screen,
    state,
    groupsAt,
    width,
    height,
    pixels: image.current?.pixels,
  })
  const detail = detailFor({ p, screen, state, groupsAt })
  const keys = keysFor(screen, state)

  return (
    <Box flexDirection="column">
      <Text> </Text>
      {state.field.focus ? (
        <FieldEditor
          width={width}
          value={state.field.text}
          hint={onScaleScreen(screen) ? 'type a hex code' : 'type an image path'}
          onChange={(text) => dispatch({ type: 'text', text })}
          onSubmit={() => dispatch({ type: 'submit' })}
          onEscape={() => dispatch({ type: 'key', input: '', key: { escape: true } })}
        />
      ) : (
        fieldRows({
          width,
          palette: p,
          content: restingField(p, screen),
          focus: false,
        }).map((row, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
          <Runs key={i} row={row} />
        ))
      )}
      <Runs row={state.error ? errorRow(p, state.error) : []} />
      {body.map((row, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
        <Runs key={i} row={row} />
      ))}
      <Text> </Text>
      <Runs row={state.flash ? flashRow(p, state.flash.text) : detail} />
      {!truecolour && p.selectionBg !== '' ? <Runs row={approximateRow(p)} /> : null}
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
    const hex = scale(screen.ref)[5]?.hex ?? ''
    return fieldValue({
      palette: p,
      value: hex,
      swatch: true,
      ...(screen.from ? { detail: screen.from } : {}),
    })
  }
  return fieldHint(p, onScaleScreen(screen) ? 'type a hex code' : 'type an image path')
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
  value,
  hint,
  onChange,
  onSubmit,
  onEscape,
}: {
  width: number
  value: string
  hint: string
  onChange: (text: string) => void
  onSubmit: () => void
  onEscape: () => void
}) {
  const p = useTheme()
  const fillProps = p.selectionBg === '' ? {} : { backgroundColor: colourProp(p.selectionBg) }
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

function bodyRows({
  p,
  screen,
  state,
  groupsAt,
  width,
  height,
  pixels,
}: {
  p: ReturnType<typeof useTheme>
  screen: Screen
  state: ColourState
  groupsAt: (level: number[]) => Group[]
  width: number
  height: number
  pixels: Pixels | undefined
}): Row[] {
  if (screen.kind === 'palette-empty') {
    return [
      [],
      ...dropZone({ width, palette: p, typing: state.field.text !== '', formats: FORMATS }),
    ]
  }
  if (screen.kind === 'scale-empty' || screen.kind === 'scale') {
    const ref: Rgb | undefined = state.preview ?? (screen.kind === 'scale' ? screen.ref : undefined)
    if (!ref)
      return [
        [],
        ...emptyRampRows({ palette: p, steps: scale({ r: 0, g: 0, b: 0 }).map((s) => s.step) }),
      ]
    const steps = scale(ref)
    const sel = screen.kind === 'scale' && !state.preview ? screen.sel : 5
    const step = steps[sel] ?? steps[5]
    if (!step) return []
    const reads = onWhiteAndBlack(step.rgb)
    return [
      [],
      ...rampRows({ palette: p, steps, selected: sel }),
      [],
      ...previewRows({ palette: p, step: { ...step, oklch: formatOklch(step.rgb), ...reads } }),
    ]
  }
  // The palette, or inside one of its colours.
  const groups = groupsAt(screen.level)
  const pcts = wholePercents(groups.map((g) => g.share))
  const items = groups.map((g, i) => ({ hex: g.hex, pct: pcts[i] as number }))
  const showPhoto = height - CHROME >= PHOTO_ROWS
  const column =
    screen.level.length === 0
      ? paletteColumn({
          palette: p,
          items,
          selected: screen.sel,
          rows: showPhoto ? PHOTO_ROWS : items.length,
        })
      : insideColumn({
          palette: p,
          parent: parentOf(screen, groupsAt),
          items,
          selected: screen.sel,
          rows: showPhoto ? PHOTO_ROWS : items.length + 2,
        })
  if (!showPhoto || !pixels) return [[], ...column.map((row) => [blank(4), ...row])]
  return [[], ...paletteBody(photoFor(p, screen, groupsAt, pixels), column)]
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
): Row[] {
  const here = groupsAt(screen.level)
  const map = photoMap(pixels, here)
  if (screen.level.length === 0) {
    return photoRows({ palette: p, map, colours: here.map((g) => g.hex), lit: screen.sel })
  }
  const top = groupsAt([])
  return photoRows({
    palette: p,
    map,
    colours: here.map((g) => g.hex),
    lit: screen.sel,
    outside: { map: photoMap(pixels, top), colours: top.map((g) => g.hex) },
  })
}

function detailFor({
  p,
  screen,
  groupsAt,
}: {
  p: ReturnType<typeof useTheme>
  screen: Screen
  state: ColourState
  groupsAt: (level: number[]) => Group[]
}): Row {
  if (screen.kind !== 'palette') return []
  const groups = groupsAt(screen.level)
  const g = groups[screen.sel]
  if (!g) return []
  if (screen.level.length === 0) {
    return detailRow(p, [
      { text: g.hex, strong: true },
      { text: formatRgb(g.rgb) },
      { text: formatOklch(g.rgb) },
    ])
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
        ['→', 'open'],
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
  return {
    main: [
      ['←→', 'choose'],
      ['↵', 'copy'],
      ['c', 'copy all'],
      ['r', 'make centre'],
    ],
    foot: [
      ['#', 'new colour'],
      ['esc', 'back'],
    ],
  }
}
