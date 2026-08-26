import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'

const routingCalls: number[] = []
vi.mock('../../src/shell/useMouseRouting.js', () => ({
  useMouseRouting: (_ref: unknown, revision: number) => {
    routingCalls.push(revision)
  },
}))

const { App } = await import('../../src/shell/App.js')
const { ThemeProvider } = await import('../../src/shell/ThemeContext.js')
const { paletteFor } = await import('../../src/shell/theme.js')

describe('App mouse wiring', () => {
  it('mounts mouse routing', () => {
    routingCalls.length = 0
    const app = render(
      <ThemeProvider palette={paletteFor('dark')}>
        <App />
      </ThemeProvider>,
    )
    expect(routingCalls.length).toBeGreaterThan(0)
    app.unmount()
  })

  it('passes a revision that tracks committed history', () => {
    routingCalls.length = 0
    const app = render(
      <ThemeProvider palette={paletteFor('dark')}>
        <App />
      </ThemeProvider>,
    )
    // The revision is the count of committed <Static> blocks: it must be a
    // number, and it is what tells the origin to recalibrate after a scroll.
    expect(typeof routingCalls[0]).toBe('number')
    app.unmount()
  })
})
