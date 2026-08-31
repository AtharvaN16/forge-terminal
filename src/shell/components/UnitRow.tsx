import { Box, Text } from 'ink'
import { useTheme } from '../ThemeContext.js'
import { colourProp } from '../theme.js'

/** The units `parseSize` accepts, in the order a person scans them. */
export const SIZE_UNIT_IDS = ['b', 'kb', 'mb', 'gb'] as const

export type SizeUnit = (typeof SIZE_UNIT_IDS)[number]

const LABELS: Record<SizeUnit, string> = { b: 'B', kb: 'KB', mb: 'MB', gb: 'GB' }

/**
 * The unit half of the target-size field, drawn as one row.
 *
 * Horizontal rather than a `Select`'s vertical list, and moved through with
 * left/right rather than up/down, because it sits *beside* the amount instead
 * of below it — a vertical list here would read as four alternative answers to
 * the whole question rather than one part of the one answer.
 *
 * Shown whether or not it has focus: the field's problem was never that the
 * units were unreachable, it was that a placeholder is the only thing that
 * ever said which units exist, and a placeholder disappears the moment
 * anything is typed.
 */
export function UnitRow({ unit, focused }: { unit: SizeUnit; focused: boolean }) {
  const palette = useTheme()
  return (
    <Box>
      {SIZE_UNIT_IDS.map((id) => {
        const selected = id === unit
        return (
          <Text key={id}>
            <Text
              bold={selected}
              {...(selected && focused && palette.selectionBg !== ''
                ? { backgroundColor: palette.selectionBg }
                : {})}
              color={colourProp(selected ? (focused ? palette.accent : palette.fg) : palette.dim)}
            >
              {` ${LABELS[id]} `}
            </Text>
            <Text> </Text>
          </Text>
        )
      })}
    </Box>
  )
}
