import chalk from 'chalk'
import { Box, type DOMElement, measureElement, useStdout } from 'ink'
import { useEffect, useMemo, useRef, useState } from 'react'
import { encodePng } from '../../core/closeup.js'
import {
  CROP_ZOOM_MIN,
  CROP_ZOOM_STEP,
  type Box as CropBox,
  type CropShape,
  centreOf,
  largestBox,
  movedBox,
  sampleDots,
  zoomedBox,
} from '../../core/crop.js'
import type { ImageInfo } from '../../core/types.js'
import type { CropView } from '../../engines/image.js'
import {
  besideRow,
  cropFactsRows,
  cropKeys,
  cropPicturePixels,
  cropPictureRows,
  cropPictureSize,
  cropPositionRow,
  cropStep,
  dotBoxOf,
  FACTS_GAP,
  PICTURE_LEFT,
  PICTURE_PX,
} from '../crop-art.js'
import { blank, type Row, width as widthOf } from '../home-art.js'
import { imageProtocol } from '../inline-image.js'
import { useTheme } from '../ThemeContext.js'
import { MODE_KEYS, modeColours, type ShellMode } from '../theme.js'
import { useInlinePictures } from '../useInlinePictures.js'
import { useKeys } from '../useKeys.js'
import { HintBar } from './HintBar.js'
import { Runs } from './Home.js'
import { StepTitle } from './StepTitle.js'

/** Where the crop stands: its box in upright pixels, and its side as a percentage of the largest's. */
export interface CropAt {
  box: CropBox
  zoom: number
}

/** The title, the blank row under it, and the key row's three (gap, rule, keys). */
const CHROME_ROWS = 5
/** When there is no room to draw the picture, a step is this fraction of a side. */
const FALLBACK_DOTS = 32

/**
 * The photo and attention's guess, read once per image and shape: the
 * preview comes back from Save as without decoding it again. The engine is
 * loaded only here, so the shell's start-up never pays for Sharp. A failed
 * read is not kept: the next visit tries again.
 */
let cache:
  | { key: string; view: Promise<CropView>; guesses: Map<string, Promise<CropBox>> }
  | undefined

function loadFor(source: ImageInfo, shape: CropShape): Promise<{ view: CropView; guess: CropBox }> {
  const key = `${source.path}\u0000${source.bytes}\u0000${source.width}x${source.height}`
  if (cache?.key !== key) {
    const fresh = {
      key,
      view: import('../../engines/image.js').then((m) => m.loadCropView(source)),
      guesses: new Map<string, Promise<CropBox>>(),
    }
    fresh.view.catch(() => {
      if (cache === fresh) cache = undefined
    })
    cache = fresh
  }
  const held = cache
  let guess = held.guesses.get(shape.label)
  if (!guess) {
    const made = Promise.all([held.view, import('../../engines/image.js')]).then(([view, m]) =>
      m.guessCrop(view, shape),
    )
    made.catch(() => {
      if (held.guesses.get(shape.label) === made) held.guesses.delete(shape.label)
    })
    held.guesses.set(shape.label, made)
    guess = made
  }
  return Promise.all([held.view, guess]).then(([view, g]) => ({ view, guess: g }))
}

const same = (a: CropBox, b: CropBox) =>
  a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height

/**
 * Crop to shape's preview (spec 2026-10-13 §2.2–2.3, mockups/crop-2026-10.html
 * P3): the whole photo in half blocks — or, where the terminal draws
 * pictures, as one — what the crop cuts hatched, the size and the share kept
 * beside it. It opens on attention's guess; the arrows
 * move the crop a dot of the picture at a time, + and − zoom it around its
 * centre, r puts it back on the guess, ↵ takes it to Save as.
 *
 * Until the photo is read the picture's place is empty: the read is short,
 * and nothing is drawn that is not the photo (invariant 7). With no colour
 * (NO_COLOR, a pipe) there is no picture at all, as on Done; one dim line
 * says where the crop sits instead.
 */
export function CropStep({
  mode,
  source,
  shape,
  initial,
  onChange,
  onSubmit,
  onCancel,
  width,
}: {
  mode: ShellMode
  source: ImageInfo
  shape: CropShape
  /** Where the crop stood when this screen was left for Save as: it opens there. */
  initial?: CropAt | undefined
  onChange?: (at: CropAt) => void
  onSubmit: (box: CropBox) => void
  onCancel: () => void
  width: number
}) {
  const palette = useTheme()
  const size = { width: source.width, height: source.height }
  const [loaded, setLoaded] = useState<{ view?: CropView; guess: CropBox } | undefined>(undefined)
  const [at, setAt] = useState<CropAt | undefined>(initial)
  // A ref too: keys in one burst each read the step the last one took.
  const atRef = useRef(at)

  const put = (next: CropAt) => {
    atRef.current = next
    setAt(next)
    onChange?.(next)
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: read once per image and shape; `put` and the rest are this render's
  useEffect(() => {
    let live = true
    loadFor(source, shape).then(
      ({ view, guess }) => {
        if (!live) return
        setLoaded({ view, guess })
        if (!atRef.current) put({ box: guess, zoom: 100 })
      },
      () => {
        // Unreadable here: the largest box, centred, and no picture. The run
        // itself says what is wrong with the file.
        if (!live) return
        const guess = largestBox(size, shape)
        setLoaded({ guess })
        if (!atRef.current) put({ box: guess, zoom: 100 })
      },
    )
    return () => {
      live = false
    }
  }, [source.path, source.bytes, shape.label])

  // The rows this screen has, measured: it takes what the frame leaves under
  // the card, never more (its content cannot push the frame taller), so it
  // follows the terminal both ways.
  const ref = useRef<DOMElement | null>(null)
  const [space, setSpace] = useState(0)
  useEffect(() => {
    if (!ref.current) return
    const h = measureElement(ref.current).height
    if (h !== space) setSpace(h)
  })

  const grid = cropPictureSize(size, space - CHROME_ROWS, width)
  const dotsAcross = grid ? { cols: grid.cols, dotRows: grid.rows * 2 } : undefined
  const step = cropStep(size, dotsAcross ?? { cols: FALLBACK_DOTS, dotRows: FALLBACK_DOTS })
  const colour = chalk.level > 0 && (process.env.NO_COLOR ?? '') === ''
  const view = loaded?.view
  const cols = colour ? (grid?.cols ?? 0) : 0
  const tall = grid?.rows ?? 0
  // Sampled again only when the picture's size or the photo changes, never on a move.
  const dots = useMemo(
    () => (view && cols > 0 ? sampleDots(view.thumb, cols, tall) : undefined),
    [view, cols, tall],
  )
  // Drawn again only when the crop's place in dots, the dots or the colours
  // it fades to change: the App re-renders this step on every press it hears
  // of, with a new palette object each time, so the colours are the key.
  const dotBox = dots && at ? dotBoxOf(size, at.box, dots) : undefined
  // The crop's corner brackets, in the mode's own colour.
  const edge = modeColours(palette, mode).fg
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the box's sides and the palette's colours, not their (new each render) objects
  const picture = useMemo(
    () => (dots && dotBox ? cropPictureRows({ palette, dots, box: dotBox, edge }) : []),
    [
      dots,
      dotBox?.x,
      dotBox?.y,
      dotBox?.w,
      dotBox?.h,
      palette.name,
      palette.canvas,
      palette.border,
      edge,
    ],
  )

  // A terminal that draws pictures (Ghostty, iTerm2) is sent the preview as
  // one, sampled a pixel a dot at PICTURE_PX dots a cell, drawn again on each
  // move; the rows leave its box blank. Everywhere else, the rows above.
  const { stdout } = useStdout()
  const protocol = stdout.isTTY && colour ? imageProtocol() : null
  const fine = useMemo(
    () =>
      view && protocol && cols > 0
        ? sampleDots(view.thumb, cols * PICTURE_PX, tall * PICTURE_PX)
        : undefined,
    [view, protocol, cols, tall],
  )
  const fineBox = fine && at ? dotBoxOf(size, at.box, fine) : undefined
  const [png, setPng] = useState<Buffer | undefined>(undefined)
  const drawn = useRef(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the box's sides and the palette's colours, as `picture` is
  useEffect(() => {
    if (!fine || !fineBox) return
    // Presses come faster than pictures are made: only the latest is shown.
    const mine = ++drawn.current
    encodePng(cropPicturePixels({ palette, dots: fine, box: fineBox, edge })).then(
      (bytes) => mine === drawn.current && setPng(bytes),
      () => {},
    )
  }, [fine, fineBox?.x, fineBox?.y, fineBox?.w, fineBox?.h, palette.name, palette.canvas, edge])
  const picturesBox = useRef<DOMElement>(null)
  const boxes = useMemo(() => [picturesBox], [])
  const pictures = useMemo(() => (protocol && png ? [png] : undefined), [protocol, png])
  useInlinePictures({
    boxes,
    pictures,
    protocol,
    cols: grid?.cols ?? 0,
    rows: grid?.rows ?? 0,
    offsets: [{ row: 0, col: PICTURE_LEFT }],
  })

  useKeys((input, key) => {
    const now = atRef.current
    if (key.escape) {
      onCancel()
      return
    }
    if (!now) return
    if (key.return) {
      onSubmit(now.box)
      return
    }
    const dx = key.rightArrow ? step.x : key.leftArrow ? -step.x : 0
    const dy = key.downArrow ? step.y : key.upArrow ? -step.y : 0
    if (dx !== 0 || dy !== 0) {
      const box = movedBox(size, now.box, dx, dy)
      if (!same(box, now.box)) put({ ...now, box })
      return
    }
    const zoom =
      input === '+' || input === '='
        ? Math.max(CROP_ZOOM_MIN, now.zoom - CROP_ZOOM_STEP)
        : input === '-' || input === '−'
          ? Math.min(100, now.zoom + CROP_ZOOM_STEP)
          : now.zoom
    if (zoom !== now.zoom) {
      put({ zoom, box: zoomedBox(size, shape, centreOf(now.box), zoom) })
      return
    }
    if (input === 'r' && loaded) {
      const back = { box: loaded.guess, zoom: 100 }
      if (now.zoom !== 100 || !same(now.box, loaded.guess)) put(back)
    }
  })

  const box = at?.box ?? largestBox(size, shape)
  const changed =
    at !== undefined && loaded !== undefined && (at.zoom !== 100 || !same(at.box, loaded.guess))
  const facts = cropFactsRows({ palette, box, size, label: shape.label })

  let rows: Row[]
  if (colour && grid) {
    rows = Array.from({ length: Math.max(grid.rows, facts.length) }, (_, i) =>
      besideRow(
        (protocol ? undefined : picture[i]) ?? (i < grid.rows ? [blank(grid.cols)] : []),
        grid.cols,
        facts[i],
      ),
    )
  } else {
    // No picture (no colour, or no room for one): where it would be, one
    // line says where the crop sits. Beside the facts where both fit, else
    // over them, so a narrow window still says the size and the share.
    const said = at ? cropPositionRow(palette, at.box) : []
    const across = widthOf(said)
    const widest = Math.max(...facts.map(widthOf))
    rows =
      PICTURE_LEFT + across + FACTS_GAP + widest <= width
        ? facts.map((fact, i) => besideRow(i === 0 ? said : [], across, fact))
        : [...(at ? [said] : []), ...facts].map((row) => [blank(PICTURE_LEFT), ...row])
  }

  return (
    <Box ref={ref} flexDirection="column" flexGrow={1} flexBasis={0} overflow="hidden">
      <StepTitle mode={mode} title={`Crop to ${shape.label}`} width={width} />
      <Box ref={picturesBox} marginTop={1} flexDirection="column">
        {rows.map((row, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
          <Runs key={i} row={row} />
        ))}
      </Box>
      <HintBar
        width={width}
        pairs={cropKeys({ size, box, changed })}
        foot={[
          [MODE_KEYS, 'mode'],
          ['esc', 'back'],
          ['ctrl-c', 'quit'],
        ]}
      />
    </Box>
  )
}
