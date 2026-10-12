import { useRef } from 'react'
import { type BarChip, type Trail, trailBarRow } from '../bar-art.js'
import { slantedChips } from '../glyphs.js'
import type { Row } from '../home-art.js'
import { easeOut, motionEnabled, useTicker, useTween } from '../motion.js'
import { useTheme } from '../ThemeContext.js'
import type { ShellMode } from '../theme.js'
import { Runs } from './Home.js'

/**
 * Whether the shell is "working": anything other than an empty idle prompt
 * (or the first-run theme picker). The home screen belongs to the empty
 * prompt; once there is work on screen, `HeaderBar` heads it.
 */
export function isWorking(step: string, staged: number): boolean {
  if (step === 'theme') return false
  return !(step === 'idle' && staged === 0)
}

/** How long a new mode takes to cross the bar. */
const WIPE_MS = 260
/** How often the drifting hatching is redrawn while a job runs. */
const DRIFT_MS = 80

/** The first `edge` cells of `next`, then the rest of `from`. */
function wiped(next: Row, from: Row, edge: number): Row {
  const cells = (row: Row) =>
    row.flatMap((run) => [...run.text].map((ch) => ({ ...run, text: ch })))
  const a = cells(next)
  const b = cells(from)
  return [...a.slice(0, edge), ...b.slice(edge)]
}

/**
 * The one row at the top of every screen after home: the mode as a chip,
 * hatching in its gradient, and the trail of answers at the far end (see
 * `trailBarRow`). No product name and no folder — where files go is said on
 * home ("saves to") and on Done ("saved to"), where it is true.
 */
export function HeaderBar({
  mode,
  trail,
  width,
  slanted,
  drift = false,
  chip,
}: {
  mode: ShellMode
  trail: Trail
  width: number
  /** Slanted chip ends; decided from the terminal when not given. */
  slanted?: boolean | undefined
  /**
   * While a job runs, the hatching drifts (W5): a moving pattern says "busy"
   * without claiming how far. Still when motion is off.
   */
  drift?: boolean
  /** A screen that is not a mode (`/extensions`) names itself in its own chip. */
  chip?: BarChip | undefined
}) {
  const palette = useTheme()
  // A palette with no ink is the first-run one, which sets no fills: no chip to slant.
  const ends = (slanted ?? slantedChips()) && palette.ink !== ''
  const moving = drift && motionEnabled(palette.name)
  const since = useRef<number | undefined>(undefined)
  if (!moving) since.current = undefined
  else since.current ??= Date.now()
  useTicker(moving, DRIFT_MS)
  const t = since.current === undefined ? undefined : (Date.now() - since.current) / 1000
  const row = trailBarRow({ width, palette, mode, trail, slanted: ends, drift: t, chip })

  // When the mode changes, the new mode's row sweeps in from the left over
  // the old one, so the change itself says the mode changed. The old row is
  // the one last drawn, captured during render so the first frame of a
  // change already knows where it came from.
  const last = useRef({ mode, row, from: undefined as Row | undefined })
  if (last.current.mode !== mode) last.current.from = last.current.row
  last.current.mode = mode
  last.current.row = row
  const k = easeOut(useTween(mode, WIPE_MS, { enabled: motionEnabled(palette.name) }))
  const from = last.current.from
  return <Runs row={k < 1 && from ? wiped(row, from, Math.round(k * width)) : row} />
}
