import { Box, Text } from 'ink'
import { ThemeProvider } from '../ThemeContext.js'
import { NEUTRAL } from '../theme.js'
import { HintBar } from './HintBar.js'
import { Select } from './Select.js'

/**
 * Rendered before any theme is known, so it wraps itself in NEUTRAL rather
 * than inheriting the ambient palette: at this moment we genuinely do not
 * know the terminal's background, and NEUTRAL sets no background fill and no
 * foreground, which makes it legible on either.
 *
 * Round 5: "Select theme", a blank row, the two names with no hints, and the
 * keys under a rule as on every other screen. The cursor opens on Dark, what
 * most terminals are.
 */
export function ThemePicker({
  width,
  onChoose,
}: {
  width: number
  onChoose: (theme: 'dark' | 'light') => void
}) {
  return (
    <ThemeProvider palette={NEUTRAL}>
      <Box flexDirection="column" marginBottom={1}>
        <Text bold>Select theme</Text>
        <Text> </Text>
        <Select
          width={width}
          items={[
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
          initialValue="dark"
          onSubmit={(value) => onChoose(value === 'light' ? 'light' : 'dark')}
        />
        <HintBar
          width={width}
          pairs={[
            ['↑↓', 'choose'],
            ['↵', 'confirm'],
          ]}
          foot={[]}
        />
      </Box>
    </ThemeProvider>
  )
}
