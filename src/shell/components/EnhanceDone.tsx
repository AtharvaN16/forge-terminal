import { basename, dirname, isAbsolute } from 'node:path'
import chalk from 'chalk'
import { Box, type DOMElement, Text, useStdout } from 'ink'
import { useEffect, useMemo, useRef, useState } from 'react'
import stringWidth from 'string-width'
import {
  type Closeup,
  type CloseupPictures,
  closeupPictures,
  findCloseup,
  forgetCloseup,
  type PixelGrid,
} from '../../core/closeup.js'
import { displayPath } from '../../utils/display-path.js'
import { HOME_MARGIN } from '../home-art.js'
import { imageProtocol } from '../inline-image.js'
import { useTheme } from '../ThemeContext.js'
import { colourProp, modeColours, SYMBOLS } from '../theme.js'
import { useInlinePictures } from '../useInlinePictures.js'
import { middleEllipsis } from '../width.js'

/**
 * Enhance's Done (X5, mockups/extensions-2026-10.html tab "2 · Done",
 * sources /tmp/forge-ext-mock2/done5.js): one quiet line — ✓ name, what was
 * done, the folder — then the picture before and after, side by side at the
 * same scale, a violet ▶ between, K3·a-style tabs on top (before dim, after
 * bold). No byte bars: for enhance the payoff is the picture.
 *
 * Where the terminal draws images (iTerm2, WezTerm, Kitty, Ghostty) the
 * pictures are the real files, written over blank boxes Ink reserves (see
 * useInlinePictures for why and how). Elsewhere — Apple Terminal, NO_COLOR, a
 * pipe — a half-block close-up of where the result changed most, at true
 * pixel scale (core/closeup.ts). Cutouts sit on a checkerboard either way.
 *
 * Pure presentation: the keys (↵ enhance another · o open · s show in
 * Finder) and the header bar belong to the App.
 */

export interface EnhanceDoneProps {
  /** `trim` and `resize` are convert jobs (Trim edges, Resize): both pictures whole. */
  op: 'boost' | 'remove-background' | 'trim' | 'resize'
  scale?: 1 | 2 | 4
  before: string
  after: string
  /** Where it went: the folder, or the written file itself. */
  savedTo: string
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
/** What the component draws besides the pictures: line, gap, tabs, gap, caption. */
const CHROME_ROWS = 5
/** How long a resize must settle before the pictures are cut again. */
export const RESIZE_SETTLE_MS = 100

/**
 * How tall the pictures are when the component has `rows` rows: as tall as
 * fits, at most `PICTURE_ROWS`; 0 when fewer than `MIN_PICTURE_ROWS` fit.
 */
export function pictureRows(rows: number | undefined): number {
  if (rows === undefined) return PICTURE_ROWS
  const fit = Math.min(PICTURE_ROWS, rows - CHROME_ROWS)
  return fit >= MIN_PICTURE_ROWS ? fit : 0
}

/** How wide each picture is for a terminal `width` columns wide. */
export function pictureCols(width: number): number {
  return Math.max(8, Math.min(48, Math.floor((width - M - GAP - 1) / 2)))
}

/** What was done, and the line's quieter second half. */
export function whatWasDone(
  op: EnhanceDoneProps['op'],
  scale: 1 | 2 | 4,
  size?: { width: number; height: number },
): { what: string; more: string } {
  const dims = size ? `${size.width} × ${size.height}` : ''
  if (op === 'remove-background') return { what: 'background removed', more: 'transparent PNG' }
  if (op === 'trim') return { what: 'edges trimmed', more: dims }
  if (op === 'resize') return { what: 'resized', more: dims }
  if (scale === 1) return { what: 'sharpened', more: dims ? `same size · ${dims}` : 'same size' }
  return { what: `${scale}× resolution`, more: dims }
}

/**
 * A grid as rows of ▀: the upper pixel the foreground, the lower the
 * background, a run of equal cells styled once. Styled through chalk, the
 * same chalk Ink draws with, so its colour level holds: FORCE_COLOR, and
 * NO_COLOR (mapped to it at start-up, `applyColourPreference`), and 256 or
 * 16 colours where the terminal has no true colour. One string per row — a
 * few hundred <Text> elements per picture would cost more than they say.
 */
export function halfBlocks(g: PixelGrid): string[] {
  const at = (x: number, y: number): [number, number, number] => {
    const i = (y * g.width + x) * 4
    return [g.rgba[i] ?? 0, g.rgba[i + 1] ?? 0, g.rgba[i + 2] ?? 0]
  }
  const same = (p: number[], q: number[]) => p[0] === q[0] && p[1] === q[1] && p[2] === q[2]
  const out: string[] = []
  for (let y = 0; y + 1 < g.height; y += 2) {
    let row = ''
    for (let x = 0; x < g.width; ) {
      const top = at(x, y)
      const low = at(x, y + 1)
      let n = 1
      while (x + n < g.width && same(at(x + n, y), top) && same(at(x + n, y + 1), low)) n++
      row += chalk.rgb(...top).bgRgb(...low)('▀'.repeat(n))
      x += n
    }
    out.push(row)
  }
  return out
}

function folderOf(savedTo: string, after: string): string {
  const folder = savedTo === after ? dirname(after) : savedTo
  return isAbsolute(folder) ? displayPath(folder) : folder
}

function caption(kind: Closeup['kind'], k: number, real: boolean): string {
  if (real) return kind === 'patch' ? 'the real pictures, at full quality' : 'the real pictures'
  if (kind === 'subject') return 'the photo, and the subject on its own'
  if (kind === 'whole') return 'the whole picture, before and after'
  if (k > 1) return 'same patch · each 2 × 2 block on the left is one pixel you had'
  return 'where it changed most, same size · one square is one pixel'
}

type Shown =
  | { real: true; pictures: CloseupPictures }
  | { real: false; closeup: Closeup }
  | { failed: true }

export function EnhanceDone({
  op,
  scale = 1,
  before,
  after,
  savedTo,
  width,
  rows: available,
}: EnhanceDoneProps) {
  const palette = useTheme()
  const { stdout } = useStdout()
  // No colour (NO_COLOR, a pipe): a picture is nothing but colour, so none.
  const colour = chalk.level > 0 && (process.env.NO_COLOR ?? '') === ''
  const protocol = stdout.isTTY && colour ? imageProtocol() : null
  const cols = pictureCols(width)
  const rows = colour ? pictureRows(available) : 0
  const whole = op === 'trim' || op === 'resize'
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

  const { what, more } = whatWasDone(op, s, (real ?? closeup)?.output)
  const name = basename(after)
  // The line keeps the name and what was done whole; the folder gives way
  // (middle-shortened), and goes when there is no room for it at all.
  const said = `${SYMBOLS.ok} ${name}   ${what}${more ? ` · ${more}` : ''}`
  const room = width - 1 - (M + 1) - stringWidth(said) - 2 - 'in '.length
  const folder = room >= 8 ? middleEllipsis(folderOf(savedTo, after), room) : ''
  const grids = useMemo(
    () =>
      closeup
        ? { before: halfBlocks(closeup.before), after: halfBlocks(closeup.after) }
        : undefined,
    [closeup],
  )
  const pictureWidth = closeup ? closeup.before.width : cols
  const height = grids ? grids.before.length : rows
  const mid = Math.floor(height / 2)
  const failed = rows === 0 || (shown !== undefined && 'failed' in shown)
  const words = real
    ? caption(real.kind, 1, true)
    : closeup
      ? caption(closeup.kind, closeup.blocksPerPixel, false)
      : ' '

  const arrow = (
    <Box width={GAP} height={height} flexDirection="column" flexShrink={0}>
      <Box height={mid} flexShrink={0} />
      <Text>
        {' '}
        <Text color={colourProp(modeColours(palette, 'enhance').fg)} bold>
          ▶
        </Text>
      </Text>
    </Box>
  )

  return (
    <Box flexDirection="column" width={width} flexShrink={0}>
      <Box paddingLeft={M + 1} width={width - 1} flexShrink={0}>
        <Box flexGrow={1} flexShrink={1}>
          <Text wrap="truncate">
            <Text color={colourProp(palette.ok)} bold>
              {`${SYMBOLS.ok} `}
            </Text>
            <Text color={colourProp(palette.fg)} bold>
              {name}
            </Text>
            {'   '}
            <Text color={colourProp(palette.dim)}>{what}</Text>
            {more ? <Text color={colourProp(palette.border)}>{` · ${more}`}</Text> : null}
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
            <Box width={pictureWidth + GAP} flexShrink={0}>
              <Text
                backgroundColor={colourProp(palette.selectionBg)}
                color={colourProp(palette.dim)}
              >
                {' before '}
              </Text>
            </Box>
            <Text
              backgroundColor={colourProp(palette.panelBand)}
              color={colourProp(palette.fg)}
              bold
            >
              {' after '}
            </Text>
          </Box>
          <Box paddingLeft={M} flexShrink={0}>
            {grids ? (
              <>
                <Box flexDirection="column" width={pictureWidth} flexShrink={0}>
                  {grids.before.map((row, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
                    <Text key={i}>{row}</Text>
                  ))}
                </Box>
                {arrow}
                <Box flexDirection="column" width={pictureWidth} flexShrink={0}>
                  {grids.after.map((row, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
                    <Text key={i}>{row}</Text>
                  ))}
                </Box>
              </>
            ) : (
              <>
                <Box ref={beforeBox} width={cols} height={rows} flexShrink={0} />
                {arrow}
                <Box ref={afterBox} width={cols} height={rows} flexShrink={0} />
              </>
            )}
          </Box>
          <Box height={1} flexShrink={0} />
          <Box paddingLeft={M + 1} flexShrink={0}>
            <Text color={colourProp(palette.border)} wrap="truncate">
              {words}
            </Text>
          </Box>
        </>
      )}
    </Box>
  )
}
