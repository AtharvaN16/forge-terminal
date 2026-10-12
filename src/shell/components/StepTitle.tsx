import { titleRow } from '../quality-art.js'
import { useTheme } from '../ThemeContext.js'
import type { ShellMode } from '../theme.js'
import { Runs } from './Home.js'

/**
 * A question's title, the way every step draws it: the question in bold, in
 * the mode's colour, and what it is about quiet at its right (Quality, Save
 * as). One component so the screens cannot drift apart again.
 */
export function StepTitle({
  mode,
  title,
  aside,
  width,
}: {
  mode: ShellMode
  title: string
  /** What the question is about: the file, the format, a count. */
  aside?: string | undefined
  width: number
}) {
  const palette = useTheme()
  return <Runs row={titleRow({ palette, mode, title, aside, width })} />
}
