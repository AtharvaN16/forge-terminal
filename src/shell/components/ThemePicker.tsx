import { Box, Text } from 'ink'
import { ThemeProvider } from '../ThemeContext.js'
import { colourProp, NEUTRAL } from '../theme.js'
import { Select } from './Select.js'

/**
 * Rendered before any theme is known, so it wraps itself in NEUTRAL rather
 * than inheriting the ambient palette: at this moment we genuinely do not
 * know the terminal's background, and NEUTRAL sets no background fill and no
 * foreground, which makes it legible on either.
 */
export function ThemePicker({ onChoose }: { onChoose: (theme: 'dark' | 'light') => void }) {
  return (
    <ThemeProvider palette={NEUTRAL}>
      <Box flexDirection="column" marginBottom={1}>
        <Text>Which theme suits your terminal?</Text>
        <Select
          width={46}
          items={[
            { value: 'dark', label: 'Dark', hint: 'light text on a dark background' },
            { value: 'light', label: 'Light', hint: 'dark text on a light background' },
          ]}
          onSubmit={(value) => onChoose(value === 'light' ? 'light' : 'dark')}
        />
        <Text color={colourProp(NEUTRAL.dim)}>
          ↑↓ choose · ↵ confirm · change it later with /theme
        </Text>
      </Box>
    </ThemeProvider>
  )
}
