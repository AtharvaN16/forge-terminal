import { createContext, type ReactNode, useContext } from 'react'
import { NEUTRAL, type Palette } from './theme.js'

/**
 * Deliberately a context rather than a module-level mutable: `/theme` swaps
 * the palette live, and tests render either theme without leaking global
 * state between cases.
 *
 * The default is NEUTRAL rather than DARK so that a component rendered
 * outside a provider — which in practice only happens in a unit test — still
 * has every key defined instead of throwing, and does so without asserting a
 * background colour it has no way to know.
 */
const ThemeContext = createContext<Palette>(NEUTRAL)

export function ThemeProvider({ palette, children }: { palette: Palette; children: ReactNode }) {
  return <ThemeContext.Provider value={palette}>{children}</ThemeContext.Provider>
}

export function useTheme(): Palette {
  return useContext(ThemeContext)
}
