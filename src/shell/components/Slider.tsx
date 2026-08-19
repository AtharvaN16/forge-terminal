import { Box, Text, useInput } from 'ink'
import { BAR } from '../theme.js'

interface SliderProps {
  label: string
  min: number
  max: number
  step: number
  value: number
  onChange: (value: number) => void
  onSubmit: (value: number) => void
  onCancel?: () => void
  width?: number
  isActive?: boolean
}

export function Slider({
  label,
  min,
  max,
  step,
  value,
  onChange,
  onSubmit,
  onCancel,
  width = 20,
  isActive = true,
}: SliderProps) {
  useInput(
    (_input, key) => {
      if (key.rightArrow) onChange(Math.min(max, value + step))
      if (key.leftArrow) onChange(Math.max(min, value - step))
      if (key.return) onSubmit(value)
      if (key.escape && onCancel) onCancel()
    },
    { isActive },
  )

  const range = max - min
  // A zero-width range (min === max) would divide by zero; a value outside
  // that range would then drive `filled` to +/-Infinity, and
  // `'━'.repeat(Infinity)` throws a RangeError during render. Guarding the
  // ratio and clamping `filled` into [0, width - 1] keeps both cases inert.
  const ratio = range === 0 ? 0 : (value - min) / range
  const filled = Math.min(Math.max(Math.round(ratio * (width - 1)), 0), width - 1)

  return (
    <Box flexDirection="column">
      <Text>{label}</Text>
      <Text>
        <Text>{BAR.filled.repeat(filled)}</Text>
        <Text bold>{BAR.knob}</Text>
        <Text dimColor>{BAR.empty.repeat(Math.max(0, width - 1 - filled))}</Text>
        <Text>{` ${value}`}</Text>
      </Text>
    </Box>
  )
}
