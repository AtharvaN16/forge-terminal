import { Box } from 'ink'
import { RESIZE_MIN, RESIZE_STEP, type Size } from '../../core/resize.js'
import { SLIDER_WIDTH } from '../quality-art.js'
import { resizeResultRows, resizeSliderRows } from '../resize-art.js'
import { useTheme } from '../ThemeContext.js'
import type { ShellMode } from '../theme.js'
import { useKeys } from '../useKeys.js'
import { HintBar } from './HintBar.js'
import { Runs } from './Home.js'
import { useSliderKeys } from './Slider.js'
import { StepTitle } from './StepTitle.js'

/**
 * Resize's size (spec 2026-10-12, mockups/resize-2026-10.html H3): Quality's
 * band, 0–200 % with 100 % in the middle, `#  type an exact size` beside it,
 * and what the size becomes under it. ←→ in steps of 5 from 5 % up to `max`
 * (200 %, or less where the result would pass the limits); ↵ takes it; `#`
 * opens the exact Width × Height pair.
 */
export function ResizeStep({
  mode,
  aside,
  from,
  percent,
  max,
  onChange,
  onSubmit,
  onExact,
  onCancel,
  width,
}: {
  mode: ShellMode
  /** The file and its upright size, at the title's right. */
  aside: string
  /** The upright size the percent is of; none for several images, each its own. */
  from?: Size | undefined
  percent: number
  max: number
  onChange: (percent: number) => void
  onSubmit: (percent: number) => void
  /** `#`: the exact Width × Height pair; absent for several images. */
  onExact?: (() => void) | undefined
  onCancel: () => void
  width: number
}) {
  const palette = useTheme()
  useSliderKeys({
    min: RESIZE_MIN,
    max,
    step: RESIZE_STEP,
    value: percent,
    onChange,
    onSubmit,
    onCancel,
  })
  useKeys((input) => {
    if (input === '#') onExact?.()
  })
  const band = Math.min(SLIDER_WIDTH, Math.max(12, width - 2))
  // Read at render time, as Quality reads it: NO_COLOR strips every fill.
  const plain = (process.env.NO_COLOR ?? '') !== '' || palette.track === ''
  return (
    <Box flexDirection="column" flexGrow={1}>
      <StepTitle mode={mode} title="Resize to" aside={aside} width={width} />
      <Box marginTop={1} flexDirection="column">
        {resizeSliderRows({
          palette,
          percent,
          width,
          band,
          plain,
          exact: onExact !== undefined,
        }).map((row, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
          <Runs key={i} row={row} />
        ))}
      </Box>
      <Box marginTop={1} flexDirection="column">
        {resizeResultRows({ palette, from, percent }).map((row, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
          <Runs key={i} row={row} />
        ))}
      </Box>
      <HintBar
        width={width}
        pairs={[
          ['←→', 'adjust'],
          ['↵', 'confirm'],
          ...(onExact ? ([['#', 'exact size']] as Array<[string, string]>) : []),
        ]}
        foot={[
          ['esc', 'back'],
          ['ctrl-c', 'quit'],
        ]}
      />
    </Box>
  )
}
