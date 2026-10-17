import { Box } from 'ink'
import { useRef } from 'react'
import { endsRow, SLIDER_WIDTH, sliderRow } from '../quality-art.js'
import { Text } from '../Text.js'
import { useTheme } from '../ThemeContext.js'
import { colourProp, MODE_KEYS, modeColours, type ShellMode } from '../theme.js'
import { useKeys } from '../useKeys.js'
import type { MeasuredSize } from '../useMeasuredSize.js'
import { HintBar } from './HintBar.js'
import { Runs } from './Home.js'
import { SizeAside } from './SizeAside.js'
import { useSliderKeys } from './Slider.js'
import { StepTitle } from './StepTitle.js'

/** The note above the keys (N4), off and on. */
const DITHER_OFF = 'Use dithering for smoother colours — the file gets bigger.'
const DITHER_ON = 'Dithering on'

/**
 * Quality (G1): the title, a grey band with the value on its thumb, which
 * end is which, and what the value would really cost — the size of an encode
 * that ran at it, measured once the value has rested (`useMeasuredSize`).
 * ←→ move it in steps, ↵ takes it.
 *
 * A PNG or GIF stops at a few `points` (A3·a), the lowest in orange (W1).
 * Under `/compress` a size no smaller than the file says "cannot compress
 * more" and ↵ greys out: nothing would be written (E3). `dither`, when given,
 * is the note above the keys and its d (N4).
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
  points = false,
  noBigger = false,
  dither,
  modeKeys = true,
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
  /** Only `min`, `max` and the steps between: each marked, the lowest in orange. */
  points?: boolean
  /** `/compress`: a result no smaller than the file cannot be confirmed. */
  noBigger?: boolean
  /** Dithering, where it would change the file: on or off, and d to switch. */
  dither?: { on: boolean; onToggle: () => void } | undefined
  /** The mode digits work here; not in a folder's flow, which a mode cannot take over. */
  modeKeys?: boolean
}) {
  const palette = useTheme()
  const blocked = noBigger && size.status === 'done' && size.bytes >= sourceBytes
  // Through a ref for the same reason as `ditherRef` below.
  const blockedRef = useRef(blocked)
  blockedRef.current = blocked
  useSliderKeys({
    min,
    max,
    step,
    value,
    onChange,
    onSubmit: (q) => {
      if (!blockedRef.current) onSubmit(q)
    },
    onCancel,
  })
  // Listening for the whole step, not only once the note shows, and reading
  // the note through a ref set as it renders (as `useSliderKeys` reads its
  // value): a listener attached after the note draws can miss a d typed the
  // moment it appears, or hold the note from the render before.
  const ditherRef = useRef(dither)
  ditherRef.current = dither
  useKeys((input) => {
    if (input === 'd') ditherRef.current?.onToggle()
  })
  const marks = points
    ? Array.from({ length: Math.floor((max - min) / step) + 1 }, (_, i) => min + i * step)
    : []
  const band = Math.min(SLIDER_WIDTH, Math.max(12, width - 2))
  // Read at render time, as `KeyRow` reads it: NO_COLOR strips every fill.
  const plain = (process.env.NO_COLOR ?? '') !== '' || palette.track === ''
  return (
    <Box flexDirection="column" flexGrow={1}>
      <StepTitle mode={mode} title="Quality" aside={aside} width={width} />
      <Box marginTop={1} flexDirection="column">
        <Runs
          row={sliderRow({
            palette,
            value,
            min,
            max,
            width: band,
            plain,
            marks,
            warn: points && value === min,
          })}
        />
        <Runs row={endsRow({ palette, width: band })} />
      </Box>
      <Box marginTop={1} marginLeft={1} height={1}>
        <SizeAside size={size} sourceBytes={sourceBytes} budget={width - 1} noBigger={noBigger} />
      </Box>
      <HintBar
        width={width}
        above={dither ? <DitherNote mode={mode} on={dither.on} plain={plain} /> : undefined}
        off={blocked ? ['↵'] : []}
        pairs={[
          ['←→', 'adjust'],
          ['↵', 'confirm'],
        ]}
        foot={[
          ...(modeKeys ? ([[MODE_KEYS, 'mode']] as Array<[string, string]>) : []),
          ['esc', 'back'],
          ['ctrl-c', 'quit'],
        ]}
      />
    </Box>
  )
}

/**
 * One row, lined up with the key row below it: d on the same grey cap as
 * those keys, and what it does. On, the d itself turns the mode's colour.
 */
function DitherNote({ mode, on, plain }: { mode: ShellMode; on: boolean; plain: boolean }) {
  const palette = useTheme()
  return (
    <Text wrap="truncate">
      {' '}
      <Text
        backgroundColor={plain ? undefined : palette.keycapBg}
        color={colourProp(on ? modeColours(palette, mode).fg : palette.fg)}
        bold
      >
        {plain ? '[d]' : ' d '}
      </Text>
      <Text color={colourProp(palette.dim)}>{` ${on ? DITHER_ON : DITHER_OFF}`}</Text>
    </Text>
  )
}
