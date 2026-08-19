import { Box, Text, useInput } from 'ink'

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
}

const FILLED = '━'
const EMPTY = '━'
const KNOB = '●'

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
}: SliderProps) {
  useInput((_input, key) => {
    if (key.rightArrow) onChange(Math.min(max, value + step))
    if (key.leftArrow) onChange(Math.max(min, value - step))
    if (key.return) onSubmit(value)
    if (key.escape && onCancel) onCancel()
  })

  const ratio = (value - min) / (max - min)
  const filled = Math.round(ratio * (width - 1))

  return (
    <Box flexDirection="column">
      <Text>{label}</Text>
      <Text>
        <Text>{FILLED.repeat(filled)}</Text>
        <Text bold>{KNOB}</Text>
        <Text dimColor>{EMPTY.repeat(Math.max(0, width - 1 - filled))}</Text>
        <Text>{` ${value}`}</Text>
      </Text>
    </Box>
  )
}
