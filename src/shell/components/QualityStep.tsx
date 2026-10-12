import { Box } from 'ink'
import { endsRow, SLIDER_WIDTH, sliderRow, titleRow } from '../quality-art.js'
import { useTheme } from '../ThemeContext.js'
import type { ShellMode } from '../theme.js'
import type { MeasuredSize } from '../useMeasuredSize.js'
import { HintBar } from './HintBar.js'
import { Runs } from './Home.js'
import { SizeAside } from './SizeAside.js'
import { useSliderKeys } from './Slider.js'

/**
 * Quality (G1): the title, a grey band with the value on its thumb, which
 * end is which, and what the value would really cost — the size of an encode
 * that ran at it, measured once the value has rested (`useMeasuredSize`).
 * ←→ move it in steps, ↵ takes it.
 */
export function QualityStep({
  mode,
  aside,
  min,
  max,
  step,
  value,
  onChange,
  onSubmit,
  onCancel,
  size,
  sourceBytes,
  width,
}: {
  mode: ShellMode
  /** What the quality is for, at the title's right: the format, or the file. */
  aside?: string | undefined
  min: number
  max: number
  step: number
  value: number
  onChange: (value: number) => void
  onSubmit: (value: number) => void
  onCancel: () => void
  size: MeasuredSize
  sourceBytes: number
  width: number
}) {
  const palette = useTheme()
  useSliderKeys({ min, max, step, value, onChange, onSubmit, onCancel })
  const band = Math.min(SLIDER_WIDTH, Math.max(12, width - 2))
  // Read at render time, as `KeyRow` reads it: NO_COLOR strips every fill.
  const plain = (process.env.NO_COLOR ?? '') !== '' || palette.track === ''
  return (
    <Box flexDirection="column">
      <Runs row={titleRow({ palette, mode, title: 'Quality', aside, width })} />
      <Box marginTop={1} flexDirection="column">
        <Runs row={sliderRow({ palette, value, min, max, width: band, plain })} />
        <Runs row={endsRow({ palette, width: band })} />
      </Box>
      <Box marginTop={1} marginLeft={1} height={1}>
        <SizeAside size={size} sourceBytes={sourceBytes} budget={width - 1} />
      </Box>
      <HintBar
        width={width}
        pairs={[
          ['←→', 'adjust'],
          ['↵', 'confirm'],
        ]}
        foot={[
          ['1–4', 'mode'],
          ['esc', 'back'],
          ['ctrl-c', 'quit'],
        ]}
      />
    </Box>
  )
}
