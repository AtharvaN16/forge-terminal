import { dirname, isAbsolute } from 'node:path'
import chalk from 'chalk'
import { Box, type DOMElement, useStdout } from 'ink'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import stringWidth from 'string-width'
import {
  type Closeup,
  type CloseupPictures,
  closeupPictures,
  DOTS_ACROSS,
  findCloseup,
  forgetCloseup,
} from '../../core/closeup.js'
import { displayName, displayPath } from '../../utils/display-path.js'
import { halfBlocks, SKETCH_ONLY } from '../halfblocks.js'
import { HOME_MARGIN } from '../home-art.js'
import { imageProtocol } from '../inline-image.js'
import { Text } from '../Text.js'
import { useTheme } from '../ThemeContext.js'
import { colourProp, modeColours, SYMBOLS } from '../theme.js'
import { useInlinePictures } from '../useInlinePictures.js'
import { middleEllipsis } from '../width.js'

/**
 * Edit's Done (X5, mockups/extensions-2026-10.html tab "2 · Done",
 * sources /tmp/forge-ext-mock2/done5.js): one quiet line — ✓ name and the
 * folder — then the picture before and after, side by side at the same scale,
 * a violet ▶ between, K3·a-style tabs on top. Each picture sits in a frame
 * the colour of its tab, so where it starts and ends shows: before in one
 * grey, after in edit's violet with its tint behind the tab
 * (mockups/open-key-2026-10.html, 02). No byte bars: for edit the payoff
 * is the picture.
 *
 * Where the terminal draws images (iTerm2, WezTerm, Kitty, Ghostty) the
 * pictures are the real files, written over blank boxes Ink reserves (see
 * useInlinePictures for why and how). Elsewhere — Apple Terminal, NO_COLOR, a
 * pipe — a close-up drawn in half blocks (shell/halfblocks.ts) of where the result
 * changed most, at true pixel scale (core/closeup.ts). Cutouts sit on a
 * checkerboard either way.
 *
 * Pure presentation: the way on (Done's `DoneActions` and keys) and the
 * header bar belong to the App.
 */

export interface EditDoneProps {
  /** `trim`, `resize` and `crop` are convert jobs (Trim edges, Resize, Crop to shape): both pictures whole. */
  op: 'boost' | 'remove-background' | 'trim' | 'resize' | 'rotate' | 'crop'
  scale?: 1 | 2 | 3 | 4
  before: string
  after: string
  /** Where it went: the folder, or the written file itself. */
  savedTo: string
  /** What the line says instead of the name and folder: "On the clipboard". */
  placed?: string | undefined
  width: number
  /**
   * The rows this component may use; the pictures take what is left after
   * its lines, at most `PICTURE_ROWS`. Undefined: the full 16.
   */
  rows?: number
}

const M = HOME_MARGIN
/** The gap between the pictures, the ▶ in it. */
const GAP = 4
/** Picture height in rows at most: the mockup's 16. */
export const PICTURE_ROWS = 16
/** Fewer rows than this for the pictures and Done says only its quiet line. */
export const MIN_PICTURE_ROWS = 6
/** What the component draws besides the pictures: line, gap, tabs, the frame's two edges. */
const CHROME_ROWS = 5
/**
 * The one note under the pictures, and only under the character fallback: a
 * reader seeing blocks should know the real file is not like that. No other
 * explainer — the user asked for none, and gave this wording (2026-10-12).
 */
export const SKETCH_NOTE = `${SKETCH_ONLY} Press O to see the result.`
/** The key the note names, drawn as a key cap where it says it, its letter in edit's colour. */
const NOTE_KEY = 'O'
/** The key as its cap draws it: a cell either side. */
const NOTE_CAP = ` ${NOTE_KEY} `
/** How long a resize must settle before the pictures are cut again. */
export const RESIZE_SETTLE_MS = 100

/** Rows the note takes under the pictures at `width`: a gap, then its lines. */
export function noteRows(width: number): number {
  const said = stringWidth(SKETCH_NOTE) - NOTE_KEY.length + NOTE_CAP.length
  return 1 + Math.ceil(said / Math.max(1, width - M - 2))
}

/**
 * How tall the pictures are when the component has `rows` rows: as tall as
 * fits, at most `PICTURE_ROWS`; 0 when fewer than `MIN_PICTURE_ROWS` fit.
 * `note`: the rows the note under pictures drawn in characters takes.
 */
export function pictureRows(rows: number | undefined, note = 0): number {
  if (rows === undefined) return PICTURE_ROWS
  const fit = Math.min(PICTURE_ROWS, rows - CHROME_ROWS - note)
  return fit >= MIN_PICTURE_ROWS ? fit : 0
}

/** How wide each picture is for a terminal `width` columns wide: its frame's two sides are not counted. */
export function pictureCols(width: number): number {
  return Math.max(8, Math.min(48, Math.floor((width - M - GAP - 1) / 2))) - 2
}

function folderOf(savedTo: string, after: string): string {
  const folder = savedTo === after ? dirname(after) : savedTo
  return isAbsolute(folder) ? displayPath(folder) : folder
}

type Shown =
  | { real: true; pictures: CloseupPictures }
  | { real: false; closeup: Closeup }
  | { failed: true }

export function EditDone({
  op,
  scale = 1,
  before,
  after,
  savedTo,
  placed,
  width,
  rows: available,
}: EditDoneProps) {
  const palette = useTheme()
  const { stdout } = useStdout()
  // No colour (NO_COLOR, a pipe): a picture is nothing but colour, so none.
  const colour = chalk.level > 0 && (process.env.NO_COLOR ?? '') === ''
  const protocol = stdout.isTTY && colour ? imageProtocol() : null
  const cols = pictureCols(width)
  const rows = colour ? pictureRows(available, protocol === null ? noteRows(width) : 0) : 0
  const whole = op === 'trim' || op === 'resize' || op === 'rotate' || op === 'crop'
  const s = op === 'boost' ? scale : 1
  const [shown, setShown] = useState<Shown | undefined>(undefined)
  useEffect(() => forgetCloseup, [])
  /** The first cut is at once; one after a resize waits for the resize to settle. */
  const cutBefore = useRef(false)

  useEffect(() => {
    if (rows === 0) return
    let live = true
    setShown(undefined)
    const opts = { cols, rows, scale: s, whole }
    const timer = setTimeout(
      () => {
        const load = protocol
          ? closeupPictures(before, after, opts).then(
              (pictures): Shown => ({ real: true, pictures }),
            )
          : findCloseup(before, after, opts).then((closeup): Shown => ({ real: false, closeup }))
        load.then(
          (v) => live && setShown(v),
          () => live && setShown({ failed: true }),
        )
      },
      cutBefore.current ? RESIZE_SETTLE_MS : 0,
    )
    cutBefore.current = true
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [before, after, cols, rows, s, whole, protocol])

  const beforeBox = useRef<DOMElement>(null)
  const afterBox = useRef<DOMElement>(null)
  const boxes = useMemo(() => [beforeBox, afterBox], [])
  const real = shown && 'real' in shown && shown.real ? shown.pictures : undefined
  const closeup = shown && 'real' in shown && !shown.real ? shown.closeup : undefined
  const pictures = useMemo(() => (real ? [real.before, real.after] : undefined), [real])
  useInlinePictures({ boxes, pictures, protocol, cols, rows })

  const name = displayName(after)
  // The line keeps the name whole; the folder gives way (middle-shortened),
  // and goes when there is no room for it at all.
  const said = `${SYMBOLS.ok} ${placed ?? name}`
  const room = width - M - (M + 1) - stringWidth(said) - 2 - 'in '.length
  const folder =
    placed === undefined && room >= 8 ? middleEllipsis(folderOf(savedTo, after), room) : ''
  const grids = useMemo(
    () =>
      closeup
        ? { before: halfBlocks(closeup.before), after: halfBlocks(closeup.after) }
        : undefined,
    [closeup],
  )
  const pictureWidth = closeup ? closeup.before.width / DOTS_ACROSS : cols
  const height = grids ? grids.before.length : rows
  // The ▶ on the middle row of the framed pictures.
  const mid = Math.floor((height + 2) / 2)
  const edit = modeColours(palette, 'edit')
  /** A picture inside its frame, `edge` its colour. */
  const frame = (edge: string, picture: ReactNode) => (
    <Box borderStyle="single" borderColor={colourProp(edge)} flexShrink={0}>
      {picture}
    </Box>
  )
  const failed = rows === 0 || (shown !== undefined && 'failed' in shown)

  const arrow = (
    <Box width={GAP} height={height + 2} flexDirection="column" flexShrink={0}>
      <Box height={mid} flexShrink={0} />
      <Text>
        {' '}
        <Text color={colourProp(edit.fg)}>▶</Text>
      </Text>
    </Box>
  )

  return (
    <Box flexDirection="column" width={width} flexShrink={0}>
      <Box paddingLeft={M + 1} width={width - M} flexShrink={0}>
        <Box flexGrow={1} flexShrink={1}>
          <Text wrap="truncate">
            <Text color={colourProp(palette.ok)} bold>
              {`${SYMBOLS.ok} `}
            </Text>
            <Text color={colourProp(palette.fg)} bold>
              {name}
            </Text>
          </Text>
        </Box>
        {folder ? (
          <Box flexShrink={0} marginLeft={2}>
            <Text>
              <Text color={colourProp(palette.border)}>in </Text>
              <Text color={colourProp(palette.dim)}>{folder}</Text>
            </Text>
          </Box>
        ) : null}
      </Box>
      {failed ? null : (
        <>
          <Box height={1} flexShrink={0} />
          <Box paddingLeft={M} flexShrink={0}>
            <Box width={pictureWidth + 2 + GAP} flexShrink={0}>
              <Text backgroundColor={colourProp(palette.panelBand)} color={colourProp(palette.dim)}>
                {' before '}
              </Text>
            </Box>
            <Text backgroundColor={colourProp(edit.bg)} color={colourProp(edit.fg)} bold>
              {' after '}
            </Text>
          </Box>
          <Box paddingLeft={M} flexShrink={0}>
            {grids ? (
              <>
                {frame(
                  palette.panelBand,
                  <Box flexDirection="column" width={pictureWidth} flexShrink={0}>
                    {grids.before.map((row, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
                      <Text key={i}>{row}</Text>
                    ))}
                  </Box>,
                )}
                {arrow}
                {frame(
                  edit.fg,
                  <Box flexDirection="column" width={pictureWidth} flexShrink={0}>
                    {grids.after.map((row, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
                      <Text key={i}>{row}</Text>
                    ))}
                  </Box>,
                )}
              </>
            ) : (
              <>
                {frame(
                  palette.panelBand,
                  <Box ref={beforeBox} width={cols} height={rows} flexShrink={0} />,
                )}
                {arrow}
                {frame(edit.fg, <Box ref={afterBox} width={cols} height={rows} flexShrink={0} />)}
              </>
            )}
          </Box>
          {grids ? (
            <>
              <Box height={1} flexShrink={0} />
              <Box paddingLeft={M + 1} width={width - 1} flexShrink={0}>
                <Text color={colourProp(palette.dim)} wrap="wrap">
                  {SKETCH_NOTE.slice(0, SKETCH_NOTE.lastIndexOf(NOTE_KEY))}
                  <Text
                    backgroundColor={colourProp(palette.keycapBg)}
                    color={colourProp(edit.fg)}
                    bold
                  >
                    {NOTE_CAP}
                  </Text>
                  {SKETCH_NOTE.slice(SKETCH_NOTE.lastIndexOf(NOTE_KEY) + NOTE_KEY.length)}
                </Text>
              </Box>
            </>
          ) : null}
        </>
      )}
    </Box>
  )
}
