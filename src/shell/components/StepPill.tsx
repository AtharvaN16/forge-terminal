import stringWidth from 'string-width'
import { Text } from '../Text.js'
import { useTheme } from '../ThemeContext.js'
import { colourProp } from '../theme.js'

/** How wide the pill is for one step: ` ‹ ` the label ` › `. */
export const pillWidth = (label: string) => stringWidth(` ‹ ${label} › `)

/**
 * A pill at the end of a band (Boost's scale, Crop's shape, Transcribe's
 * detail): ` ‹ ` the step ` › `. An arrow is lit while there is a step that
 * way; ←→ moves it, which the caller handles.
 */
export function StepPill({ labels, at }: { labels: string[]; at: number }) {
  const palette = useTheme()
  const i = Math.max(0, Math.min(at, labels.length - 1))
  const chip = palette.folderChip === '' ? {} : { backgroundColor: palette.folderChip }
  const arrow = (live: boolean, text: string) => (
    <Text bold={live} color={colourProp(live ? palette.accent : palette.border)} {...chip}>
      {text}
    </Text>
  )
  return (
    <Text>
      {arrow(i > 0, ' ‹ ')}
      <Text bold color={colourProp(palette.fg)} {...chip}>
        {labels[i]}
      </Text>
      {arrow(i < labels.length - 1, ' › ')}
    </Text>
  )
}
