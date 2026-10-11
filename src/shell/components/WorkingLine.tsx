import { Text } from 'ink'
import { useRef } from 'react'
import { SPINNER_FRAMES } from '../../cli/spinner.js'
import { motionEnabled, useTicker } from '../motion.js'
import { useTheme } from '../ThemeContext.js'
import { colourProp } from '../theme.js'

/** The CLI spinner's own pace, so the two read as one product. */
const SPIN_MS = 80

/**
 * The line shown while one file converts: a spinner, the label, and the real
 * seconds since it started. Invariant 7 forbids a percentage here — Sharp
 * reports no progress for one image — so the spinner supplies motion and the
 * clock supplies the only number, which is a true one. With motion off it is
 * the plain label, as before.
 */
export function WorkingLine({ label }: { label: string }) {
  const palette = useTheme()
  const on = motionEnabled(palette.name)
  const started = useRef(Date.now())
  const n = useTicker(on, SPIN_MS)
  if (!on) return <Text color={colourProp(palette.dim)}>{label}</Text>

  const seconds = ((Date.now() - started.current) / 1000).toFixed(1)
  return (
    <Text>
      <Text bold color={colourProp(palette.accent)}>
        {SPINNER_FRAMES[n % SPINNER_FRAMES.length]}
      </Text>
      <Text color={colourProp(palette.dim)}>{` ${label}  `}</Text>
      <Text color={colourProp(palette.border)}>{`${seconds}s`}</Text>
    </Text>
  )
}
