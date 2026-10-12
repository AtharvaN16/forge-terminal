// STUB — replaced by Task B
import { basename } from 'node:path'
import { Box, Text } from 'ink'
import { displayPath } from '../../utils/display-path.js'
import { useTheme } from '../ThemeContext.js'
import { colourProp, SYMBOLS } from '../theme.js'

export interface EnhanceDoneProps {
  op: 'boost' | 'remove-background'
  scale?: 1 | 2 | 4
  before: string
  after: string
  /** Where it went: the folder, or the written file itself. */
  savedTo: string
  width: number
}

/** STUB — replaced by Task B: the quiet line only, no pictures. */
export function EnhanceDone({ op, scale, after, savedTo }: EnhanceDoneProps) {
  const palette = useTheme()
  const what =
    op === 'remove-background'
      ? 'background removed'
      : scale === 1
        ? 'sharpened'
        : `${scale ?? 2}× resolution`
  return (
    <Box marginBottom={1}>
      <Text>
        <Text color={colourProp(palette.ok)}>{`${SYMBOLS.ok} `}</Text>
        <Text bold>{basename(after)}</Text>
        <Text color={colourProp(palette.dim)}>{` · ${what} · in ${displayPath(savedTo)}`}</Text>
      </Text>
    </Box>
  )
}
