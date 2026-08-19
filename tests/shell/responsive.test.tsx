import { render } from 'ink-testing-library'
import { afterEach, describe, expect, it } from 'vitest'
import { App } from '../../src/shell/App.js'
import { colourEnabled } from '../../src/shell/theme.js'

const settle = (ms = 120) => new Promise((r) => setTimeout(r, ms))
const originalNoColor = process.env.NO_COLOR

afterEach(() => {
  if (originalNoColor === undefined) delete process.env.NO_COLOR
  else process.env.NO_COLOR = originalNoColor
})

describe('responsiveness', () => {
  it('drops the prompt border in a compact terminal', () => {
    const narrow = render(<App initialWidth={40} />).lastFrame() ?? ''
    const normal = render(<App initialWidth={80} />).lastFrame() ?? ''
    expect(normal).toContain('╭')
    expect(narrow).not.toContain('╭')
  })

  it('never emits a line wider than the terminal', () => {
    for (const w of [40, 60, 80, 120]) {
      const frame = render(<App initialWidth={w} />).lastFrame() ?? ''
      for (const line of frame.split('\n')) {
        // eslint-disable-next-line no-control-regex
        const visible = line.replace(new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g'), '')
        expect(visible.length).toBeLessThanOrEqual(w)
      }
    }
  })
})

describe('colour', () => {
  it('is disabled when NO_COLOR is set', () => {
    process.env.NO_COLOR = '1'
    expect(colourEnabled()).toBe(false)
  })

  it('is disabled when stdout is not a tty', () => {
    delete process.env.NO_COLOR
    expect(colourEnabled()).toBe(process.stdout.isTTY === true)
  })
})
