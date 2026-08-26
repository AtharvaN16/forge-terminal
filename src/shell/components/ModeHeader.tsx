import { Box, Text } from 'ink'
import type { ReactNode } from 'react'
import { useTheme } from '../ThemeContext.js'
import { colourProp, type Palette } from '../theme.js'

export type ShellMode = 'convert' | 'compress' | 'pdf'

type ModeStyle = {
  borderStyle: 'single' | 'round' | 'double'
  marker: string
  colour: string
}

function styleFor(mode: ShellMode, palette: Palette): ModeStyle {
  if (mode === 'convert') {
    return { borderStyle: 'single', marker: '↔', colour: palette.modeConvert }
  }
  if (mode === 'compress') {
    return { borderStyle: 'round', marker: '↓', colour: palette.modeCompress }
  }
  return { borderStyle: 'double', marker: '▣', colour: palette.modePdf }
}

export function ModeHeader({
  mode,
  title,
  width,
  children,
}: {
  mode: ShellMode
  title: string
  width: number
  children?: ReactNode
}) {
  const palette = useTheme()
  const style = styleFor(mode, palette)
  const compact = width < 40
  const displayTitle = compact ? (mode === 'pdf' ? 'PDF' : mode) : title

  return (
    <Box
      flexDirection="column"
      width={width}
      borderStyle={style.borderStyle}
      borderColor={colourProp(style.colour)}
      paddingX={1}
      marginBottom={1}
    >
      <Text>
        <Text color={colourProp(style.colour)} bold>
          {`${style.marker} ${displayTitle}`}
        </Text>
        {!compact ? <Text color={colourProp(palette.dim)}>{`  ${mode.toUpperCase()}`}</Text> : null}
      </Text>
      {children}
    </Box>
  )
}
