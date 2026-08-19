import { Box, Text, useInput } from 'ink'
import { useRef } from 'react'
import { useTheme } from '../ThemeContext.js'
import { BAR, colourProp } from '../theme.js'

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
  /**
   * The same ref `Prompt`, `Select` and `PathInput` keep, and for the same
   * reason: `useInput` handlers are synchronous while `useState` (and a
   * parent's controlled `value`) is not, so a burst of keys delivered in one
   * stdin chunk runs through this one closure several times before React
   * re-renders. Reading the `value` *prop* there reads the value as of the
   * last render — measured: three RIGHTs in one write moved one step, and a
   * RIGHT+ENTER burst submitted the value from *before* the RIGHT while the
   * frame showed the value after it. Assigning in the render body (not an
   * effect) keeps this current as of the most recent render, synchronously.
   */
  const valueRef = useRef(value)
  valueRef.current = value

  const nudge = (delta: number) => {
    const next = Math.min(max, Math.max(min, valueRef.current + delta))
    if (next === valueRef.current) return // already at an end: nothing moved
    valueRef.current = next
    onChange(next)
  }

  useInput(
    (_input, key) => {
      if (key.rightArrow) nudge(step)
      if (key.leftArrow) nudge(-step)
      if (key.return) onSubmit(valueRef.current)
      if (key.escape && onCancel) onCancel()
    },
    { isActive },
  )

  const palette = useTheme()

  const range = max - min
  // A zero-width range (min === max) would divide by zero; a value outside
  // that range would then drive `filled` to +/-Infinity, and
  // `'━'.repeat(Infinity)` throws a RangeError during render. Guarding the
  // ratio and clamping `filled` into [0, width - 1] keeps both cases inert.
  const ratio = range === 0 ? 0 : (value - min) / range
  const filled = Math.min(Math.max(Math.round(ratio * (width - 1)), 0), width - 1)

  return (
    <Box flexDirection="column">
      <Text color={colourProp(palette.dim)}>{label}</Text>
      <Text>
        <Text color={colourProp(palette.accent)}>{BAR.filled.repeat(filled)}</Text>
        <Text bold color={colourProp(palette.accent)}>
          {BAR.knob}
        </Text>
        <Text color={colourProp(palette.border)}>
          {BAR.empty.repeat(Math.max(0, width - 1 - filled))}
        </Text>
        <Text color={colourProp(palette.fg)}>{` ${value}`}</Text>
      </Text>
    </Box>
  )
}
