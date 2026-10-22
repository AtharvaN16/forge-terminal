import { Box } from 'ink'
import { SPINNER_FRAMES } from '../../cli/spinner.js'
import type { Row } from '../home-art.js'
import { motionEnabled, useTicker } from '../motion.js'
import { useTheme } from '../ThemeContext.js'
import type { ShellMode } from '../theme.js'
import {
  clockFor,
  doneLine,
  nextLine,
  pagesRow,
  partsRow,
  timeRow,
  triesRow,
  workLine,
} from '../working-art.js'
import { HintBar } from './HintBar.js'
import { Runs } from './Home.js'

/** The CLI spinner's own pace, so the two read as one product. */
const SPIN_MS = 80

/**
 * Working (W5): what sits under the file card while a long job runs — the
 * header bar above it drifts on its own. One line says what is happening now,
 * in the job's own words; a real count, where there is one, sits under it.
 * Nothing here is estimated: the label is the phase the engine reported, the
 * dots are the size search's tries against its own bound, the bar is pages
 * done of a known total, and the clock is the real time since the job began.
 *
 * Only what can be stopped offers esc. The key row says what the keys do and
 * nothing more — no footnote (2026-10-22).
 *
 * A job of two steps (transcribe: Transcribing, then Writing notes) shows the
 * step before as "✓ Transcribing 1m 08s" and the step after, faint, under
 * the count (mockups/transcribe-2026-10-round4.html, decided 2026-10-22).
 */
export function Working({
  mode,
  label,
  startedAt,
  search,
  pages,
  time,
  progress,
  parts,
  finished,
  next,
  stoppable = false,
  unit,
  width,
}: {
  mode: ShellMode
  /** The true phase ("Encoding AVIF"), or what the count is of ("Splitting report.pdf"). */
  label: string
  /** When the job began (`Date.now()`), for the clock. */
  startedAt: number
  /** The size search, while it runs: tries done, of this rung's bound. */
  search?: { n: number; of: number } | undefined
  /** Pages done of a known total, for an operation that reports them. */
  pages?: { done: number; total: number } | undefined
  /** A video's or sound file's seconds encoded of its true total, and when this pass began. */
  time?: { done: number; total: number; since: number } | undefined
  /** A true amount of a known total that is not whole things, and how to say it: "23:10 of 1:01:57". */
  progress?: { done: number; total: number; says: string } | undefined
  /** Parts of a known count, done of all, as two-cell squares (transcribe's notes). */
  parts?: { done: number; of: number } | undefined
  /** The step before this one, done, and how long it took ("1m 08s"). */
  finished?: { label: string; took: string } | undefined
  /** The step after this one, still to come. */
  next?: string | undefined
  /** esc stops this job (an extension's child is killed; nothing is written). */
  stoppable?: boolean | undefined
  /** What `pages` counts when it is not pages: a folder's files ("images"). */
  unit?: string | undefined
  width: number
}) {
  const palette = useTheme()
  const on = motionEnabled(palette.name)
  // Ticks with motion off too: the spinner stays still, but the clock is a fact.
  const n = useTicker(true, SPIN_MS)
  const spinner = on ? SPINNER_FRAMES[n % SPINNER_FRAMES.length] : undefined
  const clock = clockFor(Date.now() - startedAt)

  const count: Row | undefined = parts
    ? partsRow({ palette, mode, done: parts.done, of: parts.of })
    : search
      ? triesRow({ palette, mode, n: search.n, of: search.of })
      : progress
        ? pagesRow({ palette, mode, ...progress })
        : pages
          ? pagesRow({
              palette,
              mode,
              done: pages.done,
              total: pages.total,
              unit,
              // Read at render time, as `KeyRow` reads it: NO_COLOR strips every colour.
              plain: (process.env.NO_COLOR ?? '') !== '' || palette.track === '',
            })
          : time
            ? timeRow({
                palette,
                mode,
                done: time.done,
                total: time.total,
                elapsedMs: Date.now() - time.since,
                plain: (process.env.NO_COLOR ?? '') !== '' || palette.track === '',
              })
            : undefined
  return (
    <Box flexDirection="column" flexGrow={1}>
      {finished ? (
        <Box marginBottom={1}>
          <Runs row={doneLine({ palette, label: finished.label, took: finished.took, width })} />
        </Box>
      ) : null}
      <Runs row={workLine({ palette, mode, spinner, label, clock, width })} />
      {count ? (
        <Box marginTop={1}>
          <Runs row={count} />
        </Box>
      ) : null}
      {next ? (
        <Box marginTop={1}>
          <Runs row={nextLine({ palette, label: next })} />
        </Box>
      ) : null}
      <HintBar
        width={width}
        pairs={search || stoppable ? [['esc', 'stop']] : []}
        foot={[['ctrl-c', 'quit']]}
      />
    </Box>
  )
}
