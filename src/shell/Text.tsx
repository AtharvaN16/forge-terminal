import { Text as InkText, type TextProps } from 'ink'
import { createContext, useContext } from 'react'
import { useTheme } from './ThemeContext.js'
import { paintsCanvas } from './theme.js'

/** Set inside a Text: a nested one inherits its colour rather than resetting it. */
const InText = createContext(false)

/**
 * Ink's Text, owning the foreground wherever the shell owns the background.
 *
 * Light paints its own canvas (see `paintsCanvas`), but a Text that names no
 * colour is drawn in the terminal's foreground — white in a dark profile, so
 * on the painted white it vanished (unselected picker rows, 2026-10-12). A
 * theme that paints its background has to paint its ink too: the outermost
 * Text takes the palette's `fg` when it is given no colour. A nested Text is
 * left alone, so it still inherits from the one around it. Dark and the
 * neutral palette keep the terminal's own foreground, which is right on the
 * terminal's own background.
 *
 * The shell imports Text from here, never from 'ink' (biome enforces it).
 */
export function Text(props: TextProps) {
  const nested = useContext(InText)
  const palette = useTheme()
  const ink = !nested && props.color === undefined && paintsCanvas(palette) ? palette.fg : undefined
  return (
    <InText.Provider value={true}>
      <InkText {...props} {...(ink ? { color: ink } : {})} />
    </InText.Provider>
  )
}
