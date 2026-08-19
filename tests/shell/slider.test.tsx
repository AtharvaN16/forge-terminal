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
})
