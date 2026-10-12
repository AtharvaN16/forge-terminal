import { basename, dirname, isAbsolute } from 'node:path'
import { Box, type DOMElement, Text, useStdout } from 'ink'
import { useEffect, useMemo, useRef, useState } from 'react'
import stringWidth from 'string-width'
import {
  type Closeup,
  type CloseupPictures,
  closeupPictures,
  findCloseup,
  type PixelGrid,
} from '../../core/closeup.js'
import { displayPath } from '../../utils/display-path.js'
import { HOME_MARGIN } from '../home-art.js'
import { imageProtocol } from '../inline-image.js'
import { useTheme } from '../ThemeContext.js'
import { colourProp, SYMBOLS } from '../theme.js'
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
  op: 'boost' | 'remove-background'
  scale?: 1 | 2 | 4
  before: string
  after: string
  /** Where it went: the folder, or the written file itself. */
  savedTo: string
  width: number
}

const M = HOME_MARGIN
/** The gap between the pictures, the ▶ in it. */
const GAP = 4
/** Picture height in rows: the mockup's 16, so the body is 21 rows and fits 80 × 24. */
export const PICTURE_ROWS = 16
/** The mode's colour for the arrow (enhance violet, the mockup's #b39ae8). */
const ENHANCE_VIOLET = '#b39ae8'

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
  if (scale === 1) return { what: 'sharpened', more: dims ? `same size · ${dims}` : 'same size' }
  return { what: `${scale}× resolution`, more: dims }
}

const SGR = (n: string) => `\u001b[${n}m`
const rgbAt = (g: PixelGrid, x: number, y: number) => {
  const i = (y * g.width + x) * 4
  return `${g.rgba[i] ?? 0};${g.rgba[i + 1] ?? 0};${g.rgba[i + 2] ?? 0}`
}

/**
 * A grid as rows of ▀: the upper pixel the foreground, the lower the
 * background. Truecolour SGR straight in the string (Ink keeps SGR as it is)
 * — a few hundred <Text> elements per picture would cost more than they say.
 */
export function halfBlocks(g: PixelGrid): string[] {
  const out: string[] = []
  for (let y = 0; y + 1 < g.height; y += 2) {
    let row = ''
    let fg = ''
    let bg = ''
    for (let x = 0; x < g.width; x++) {
      const top = rgbAt(g, x, y)
      const low = rgbAt(g, x, y + 1)
      if (top !== fg) row += SGR(`38;2;${top}`)
      if (low !== bg) row += SGR(`48;2;${low}`)
      fg = top
      bg = low
      row += '▀'
    }
    out.push(row + SGR('39;49'))
  }
  return out
}

function folderOf(savedTo: string, after: string): string {
  const folder = savedTo === after ? dirname(after) : savedTo
  return isAbsolute(folder) ? displayPath(folder) : folder
}

function caption(kind: 'patch' | 'subject', k: number, real: boolean): string {
  if (real) return kind === 'subject' ? 'the real pictures' : 'the real pictures, at full quality'
  if (kind === 'subject') return 'the photo, and the subject on its own'
  if (k > 1) return 'same patch · each 2 × 2 block on the left is one pixel you had'
  return 'where it changed most, same size · one square is one pixel'
}

type Shown =
  | { real: true; pictures: CloseupPictures }
  | { real: false; closeup: Closeup }
  | { failed: true }

export function EnhanceDone({ op, scale = 1, before, after, savedTo, width }: EnhanceDoneProps) {
  const palette = useTheme()
  const { stdout } = useStdout()
  const protocol = stdout.isTTY ? imageProtocol() : null
  const cols = pictureCols(width)
  const rows = PICTURE_ROWS
  const s = op === 'remove-background' ? 1 : scale
  const [shown, setShown] = useState<Shown | undefined>(undefined)

  useEffect(() => {
    let live = true
    setShown(undefined)
    const opts = { cols, rows: PICTURE_ROWS, scale: s }
    const load = protocol
      ? closeupPictures(before, after, opts).then((pictures): Shown => ({ real: true, pictures }))
      : findCloseup(before, after, opts).then((closeup): Shown => ({ real: false, closeup }))
    load.then(
      (v) => live && setShown(v),
      () => live && setShown({ failed: true }),
    )
    return () => {
      live = false
    }
  }, [before, after, cols, s, protocol])

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
  const failed = shown !== undefined && 'failed' in shown
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
        <Text color={colourProp(palette.name === 'neutral' ? palette.violet : ENHANCE_VIOLET)} bold>
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
