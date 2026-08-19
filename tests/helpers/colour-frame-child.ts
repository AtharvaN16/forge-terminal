/**
 * Renders the shell's idle frame in a *fresh* process and prints it as JSON.
 *
 * It has to be a fresh process: chalk fixes its colour level the first time
 * it is imported and never reconsults the environment, so whether Ink emits
 * ANSI at all is decided before any in-process test could intervene — and
 * vitest externalises node_modules, so `vi.resetModules()` cannot re-import
 * chalk either. Measured: with chalk already loaded, the frame is
 * colour-free no matter what the environment says, which is exactly why a
 * NO_COLOR assertion made in-process would pass without proving anything.
 *
 * The caller supplies FORCE_COLOR to stand in for the colour-capable TTY a
 * spawned pipe is not, and NO_COLOR for the case under test.
 */
import { applyColourPreference } from '../../src/shell/theme.js'

// Stand in for the terminal a spawned pipe is not. `colourEnabled()` refuses
// colour on a non-TTY stdout too (correctly), which would make every run of
// this child colour-free and the NO_COLOR assertion vacuous.
Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true })

// Exactly what src/index.ts does before it imports the shell.
applyColourPreference()

// Dynamic, so Ink (and chalk beneath it) load *after* the line above. Static
// imports are hoisted and would defeat the whole point.
const { render } = await import('ink-testing-library')
const { createElement } = await import('react')
const { App } = await import('../../src/shell/App.js')

const frame = render(createElement(App, { initialWidth: 80 })).lastFrame() ?? ''
process.stdout.write(JSON.stringify(frame))
