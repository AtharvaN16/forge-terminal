import { Box, Text } from 'ink'
import { useRef } from 'react'
import stringWidth from 'string-width'
import { displayPath } from '../../utils/display-path.js'
import { easeOut, motionEnabled, useTween } from '../motion.js'
import { useTheme } from '../ThemeContext.js'
import { colourProp, MODE_MARKERS, modeColours, type ShellMode } from '../theme.js'
import { bandFor, middleEllipsis } from '../width.js'

/**
 * Whether the shell is "working": anything other than an empty idle prompt
 * (or the first-run theme picker). The full logo belongs to the empty
 * prompt; once there is work on screen, `HeaderBar` takes over from it.
 */
export function isWorking(step: string, staged: number): boolean {
  if (step === 'theme') return false
  return !(step === 'idle' && staged === 0)
}

/** How long a new mode's fill takes to cross the bar. */
const WIPE_MS = 260

interface Segment {
  text: string
  color?: string | undefined
  bold?: boolean
}

/**
 * The bar's segments on its fill. Mid-wipe, every cell left of `edge` is on
 * the new fill and every cell right of it still on the old one, so the new
 * mode's colour sweeps in from the left — the change itself says the mode
 * changed. The words are the new mode's throughout.
 */
function Filled({
  segments,
  width,
  bg,
  wipe,
}: {
  segments: Segment[]
  width: number
  bg: string
  wipe?: { edge: number; from: string } | undefined
}) {
  if (!wipe) {
    return (
      <Box width={width} backgroundColor={colourProp(bg)}>
        {segments.map((seg, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed, ordered set of segments
          <Text key={i} color={colourProp(seg.color ?? '')} bold={seg.bold ?? false}>
            {seg.text}
          </Text>
        ))}
      </Box>
    )
  }
  const parts: Array<Segment & { bg: string }> = []
  let col = 0
  // Counted in terminal columns, not characters: a wide glyph in the folder
  // path takes two cells, and the edge is a cell position.
  for (const seg of segments) {
    let before = ''
    let after = ''
    for (const ch of seg.text) {
      if (col < wipe.edge) before += ch
      else after += ch
      col += stringWidth(ch)
    }
    if (before) parts.push({ ...seg, text: before, bg })
    if (after) parts.push({ ...seg, text: after, bg: wipe.from })
  }
  return (
    <Box width={width}>
      {parts.map((part, i) => (
        <Text
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed, ordered set of segments
          key={i}
          color={colourProp(part.color ?? '')}
          bold={part.bold ?? false}
          backgroundColor={colourProp(part.bg)}
        >
          {part.text}
        </Text>
      ))}
    </Box>
  )
}

/**
 * One row, the width of the terminal, on the mode's own fill: the product
 * and mode on the left, the folder the next file will be saved to on the
 * right. It replaces the `current mode:` bar once the user is working
 * (spec 2026-10-11 §4). The mode name is always paired with its marker, so
 * the bar still says where you are under NO_COLOR.
 */
export function HeaderBar({
  mode,
  detail,
  defaultOutput,
  width,
}: {
  mode: ShellMode
  /** A staged file's name, shown after the mode while waiting at the prompt. */
  detail?: string | undefined
  defaultOutput: string
  width: number
}) {
  const palette = useTheme()
  const { fg, bg } = modeColours(palette, mode)
  const marker = MODE_MARKERS[mode]

  // The fill the bar had before the mode last changed, captured during
  // render so the first frame of a change already knows where it came from.
  const last = useRef({ mode, from: bg })
  if (last.current.mode !== mode) {
    last.current = { mode, from: modeColours(palette, last.current.mode).bg }
  }
  const k = easeOut(useTween(mode, WIPE_MS, { enabled: motionEnabled(palette.name) }))
  const wipe =
    k < 1 && last.current.from !== bg
      ? { edge: Math.round(k * width), from: last.current.from }
      : undefined

  if (bandFor(width) === 'compact') {
    const text = ` ${marker} ${mode}`
    return (
      <Filled
        width={width}
        bg={bg}
        wipe={wipe}
        segments={[
          { text, color: fg, bold: true },
          { text: ' '.repeat(Math.max(0, width - stringWidth(text))) },
        ]}
      />
    )
  }

  const brand = ` ${marker} FORGE `
  const modeText = `  ${mode}`
  // What the folder and the staged name share: everything but the brand,
  // the mode, a two-column gap and the trailing pad. The folder is the
  // setting this bar exists to show, so it is fitted first (up to 30
  // columns); the name gets what is left, or is dropped when that is too
  // little to read — the file card below names it anyway.
  const shared = width - stringWidth(brand) - stringWidth(modeText) - 3
  const right = middleEllipsis(displayPath(defaultOutput), Math.max(4, Math.min(30, shared)))
  const detailRoom = shared - stringWidth(right) - 3 // ' · '
  const middle =
    detail && detailRoom >= 8 ? `${modeText} · ${middleEllipsis(detail, detailRoom)}` : modeText
  const gap = Math.max(1, width - stringWidth(brand) - stringWidth(middle) - stringWidth(right) - 1)
  return (
    <Filled
      width={width}
      bg={bg}
      wipe={wipe}
      segments={[
        { text: brand, color: fg, bold: true },
        { text: middle, color: palette.dim },
        { text: ' '.repeat(gap) },
        { text: right, color: palette.dim },
        { text: ' ' },
      ]}
    />
  )
}
