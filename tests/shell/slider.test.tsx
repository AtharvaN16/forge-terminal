import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import { Slider } from '../../src/shell/components/Slider.js'

const ESC = String.fromCharCode(27)
const RIGHT = `${ESC}[C`
const LEFT = `${ESC}[D`
const ENTER = String.fromCharCode(13)

const settle = () => new Promise((r) => setTimeout(r, 60))

function base(over: Partial<Parameters<typeof Slider>[0]> = {}) {
  return {
    label: 'Quality',
    min: 1,
    max: 100,
    step: 5,
    value: 80,
    onChange: () => {},
    onSubmit: () => {},
    ...over,
  }
}

describe('Slider', () => {
  it('shows the label and the current value as a number, not just a bar', () => {
    const { lastFrame } = render(<Slider {...base()} />)
    expect(lastFrame()).toContain('Quality')
    expect(lastFrame()).toContain('80')
  })

  it('draws a filled and unfilled bar', () => {
    const frame = render(<Slider {...base()} />).lastFrame() ?? ''
    expect(frame).toContain('━')
    expect(frame).toContain('●')
  })

  it('increases by one step on right arrow', async () => {
    const onChange = vi.fn()
    const { stdin } = render(<Slider {...base({ onChange })} />)
    stdin.write(RIGHT)
    await settle()
    expect(onChange).toHaveBeenCalledWith(85)
  })

  it('decreases by one step on left arrow', async () => {
    const onChange = vi.fn()
    const { stdin } = render(<Slider {...base({ onChange })} />)
    stdin.write(LEFT)
    await settle()
    expect(onChange).toHaveBeenCalledWith(75)
  })

  it('clamps at the maximum', async () => {
    const onChange = vi.fn()
    const { stdin } = render(<Slider {...base({ value: 99, onChange })} />)
    stdin.write(RIGHT)
    await settle()
    expect(onChange).toHaveBeenCalledWith(100)
  })

  it('clamps at the minimum', async () => {
    const onChange = vi.fn()
    const { stdin } = render(<Slider {...base({ value: 3, onChange })} />)
    stdin.write(LEFT)
    await settle()
    expect(onChange).toHaveBeenCalledWith(1)
  })

  it('submits the current value on enter', async () => {
    const onSubmit = vi.fn()
    const { stdin } = render(<Slider {...base({ onSubmit })} />)
    stdin.write(ENTER)
    await settle()
    expect(onSubmit).toHaveBeenCalledWith(80)
  })

  it('renders sensibly on a degenerate range, even when value sits outside it', () => {
    // min === max makes ratio = (value - min) / (max - min) a division by
    // zero. When value === min that's an accidentally-survivable NaN, but
    // a value outside a zero-width range drives ratio to +/-Infinity, and
    // '━'.repeat(Infinity) throws a RangeError during render.
    //
    // NB: `expect(() => render(...)).not.toThrow()` does NOT catch this in
    // this harness — Ink's own <ErrorBoundary> (see node_modules/ink/build/
    // components/App.js) swallows render errors before they ever reach the
    // caller, so the throw never crosses the synchronous try/catch a
    // `.not.toThrow()` assertion relies on. Asserting on the frame's actual
    // content is the only way this test can fail against the unfixed code
    // (verified: unfixed code renders a bare `"\n"` here, not the label).
    const { lastFrame } = render(<Slider {...base({ min: 50, max: 50, value: 75 })} />)
    const frame = lastFrame() ?? ''
    expect(frame).toContain('Quality')
    expect(frame).toContain('75')
  })

  /**
   * Every test above writes one key per settle, which hides the whole class
   * of bug: `useInput` handlers run synchronously between renders, so a
   * burst delivered in a single write reaches the *same* handler closure
   * several times before React re-renders. Reading the `value` prop there
   * means reading the value as of the last render, not the value the user
   * has actually reached.
   *
   * Measured against the unfixed component:
   *   three RIGHTs in ONE write -> onChange: [85,85,85]   (one step, not three)
   *   RIGHT+ENTER in ONE write  -> onChange: [85], onSubmit: [80]
   *
   * The second is the same defect already fixed in `Select`: submitting
   * something other than what the frame shows.
   */
  it('accumulates a burst of arrows delivered in one write', async () => {
    const onChange = vi.fn()
    const { stdin } = render(<Slider {...base({ onChange })} />)
    stdin.write(RIGHT + RIGHT + RIGHT)
    await settle()
    expect(onChange.mock.calls.map((c) => c[0])).toEqual([85, 90, 95])
  })

  it('submits what the burst actually reached, not what the last render showed', async () => {
    const onChange = vi.fn()
    const onSubmit = vi.fn()
    const { stdin } = render(<Slider {...base({ onChange, onSubmit })} />)
    stdin.write(RIGHT + RIGHT + ENTER)
    await settle()
    expect(onSubmit).toHaveBeenCalledWith(90)
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('re-reads a value the parent changed under it', async () => {
    const onChange = vi.fn()
    const { stdin, rerender } = render(<Slider {...base({ value: 80, onChange })} />)
    rerender(<Slider {...base({ value: 20, onChange })} />)
    await settle()
    stdin.write(RIGHT)
    await settle()
    expect(onChange).toHaveBeenLastCalledWith(25)
  })

  it('ignores arrows and enter while inactive', async () => {
    const onChange = vi.fn()
    const onSubmit = vi.fn()
    const { stdin } = render(<Slider {...base({ onChange, onSubmit, isActive: false })} />)
    stdin.write(RIGHT)
    await settle()
    stdin.write(ENTER)
    await settle()
    expect(onChange).not.toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
