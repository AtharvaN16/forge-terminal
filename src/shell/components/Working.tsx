import { Box } from 'ink'
import { SPINNER_FRAMES } from '../../cli/spinner.js'
import type { Row } from '../home-art.js'
import { motionEnabled, useTicker } from '../motion.js'
import { useTheme } from '../ThemeContext.js'
import type { ShellMode } from '../theme.js'
import { clockFor, pagesRow, triesRow, workLine } from '../working-art.js'
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
 * Only the size search can be stopped (between encodes), so only it offers
 * esc; anything else says what stopping would cost: nothing, as nothing is
 * written until the end.
 */
export function Working({
  mode,
  label,
  startedAt,
  search,
  pages,
  stoppable = false,
  unit,
  savedAsItGoes = false,
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
  /** esc stops this job (an extension's child is killed; nothing is written). */
  stoppable?: boolean | undefined
  /** What `pages` counts when it is not pages: a folder's files ("images"). */
  unit?: string | undefined
  /** Each file is saved as it finishes (a folder), so the footnote must not say otherwise. */
  savedAsItGoes?: boolean
  width: number
}) {
  const palette = useTheme()
  const on = motionEnabled(palette.name)
  // Ticks with motion off too: the spinner stays still, but the clock is a fact.
  const n = useTicker(true, SPIN_MS)
  const spinner = on ? SPINNER_FRAMES[n % SPINNER_FRAMES.length] : undefined
  const clock = clockFor(Date.now() - startedAt)

  const count: Row | undefined = search
    ? triesRow({ palette, mode, n: search.n, of: search.of })
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
      : undefined
  return (
    <Box flexDirection="column" flexGrow={1}>
      <Runs row={workLine({ palette, mode, spinner, label, clock, width })} />
      {count ? (
        <Box marginTop={1}>
          <Runs row={count} />
        </Box>
      ) : null}
      {search ? (
        <HintBar width={width} pairs={[['esc', 'stop']]} foot={[['ctrl-c', 'quit']]} />
      ) : (
        <HintBar
          width={width}
          pairs={stoppable ? [['esc', 'stop']] : []}
          foot={[
            ...(savedAsItGoes
              ? []
              : ([['nothing is saved until it is done', '']] as Array<[string, string]>)),
            ['ctrl-c', 'quit'],
          ]}
        />
      )}
    </Box>
  )
}
