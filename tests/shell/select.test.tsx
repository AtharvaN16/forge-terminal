import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import type { Choice } from '../../src/core/actions.js'
import { Select } from '../../src/shell/components/Select.js'

const ESC = String.fromCharCode(27)
const DOWN = `${ESC}[B`
const UP = `${ESC}[A`
const ENTER = String.fromCharCode(13)
const ESCAPE = ESC

const items: Choice[] = [
  { value: 'webp', label: 'WebP', hint: 'smaller, modern' },
  { value: 'png', label: 'PNG', hint: 'lossless' },
  { value: 'avif', label: 'AVIF', hint: 'smallest' },
]

const settle = () => new Promise((r) => setTimeout(r, 60))

describe('Select', () => {
  it('marks the first item with a cursor and bold, not colour alone', () => {
    const { lastFrame } = render(<Select items={items} onSubmit={() => {}} />)
    const frame = lastFrame() ?? ''
    expect(frame).toContain('❯ WebP')
    expect(frame).toContain('  PNG')
  })

  it('shows each choice hint', () => {
    const { lastFrame } = render(<Select items={items} onSubmit={() => {}} />)
    expect(lastFrame()).toContain('smaller, modern')
  })

  it('moves the cursor down', async () => {
    const { stdin, lastFrame } = render(<Select items={items} onSubmit={() => {}} />)
    stdin.write(DOWN)
    await settle()
    expect(lastFrame()).toContain('❯ PNG')
  })

  it('moves the cursor up', async () => {
    const { stdin, lastFrame } = render(<Select items={items} onSubmit={() => {}} />)
    stdin.write(DOWN)
    await settle()
    stdin.write(UP)
    await settle()
    expect(lastFrame()).toContain('❯ WebP')
  })

  it('stops at the ends rather than wrapping', async () => {
    const { stdin, lastFrame } = render(<Select items={items} onSubmit={() => {}} />)
    stdin.write(UP)
    await settle()
    expect(lastFrame()).toContain('❯ WebP')
    stdin.write(DOWN + DOWN + DOWN + DOWN)
    await settle()
    expect(lastFrame()).toContain('❯ AVIF')
  })

  it('submits the highlighted value on enter', async () => {
    const onSubmit = vi.fn()
    const { stdin } = render(<Select items={items} onSubmit={onSubmit} />)
    stdin.write(DOWN)
    await settle()
    stdin.write(ENTER)
    await settle()
    expect(onSubmit).toHaveBeenCalledWith('png')
  })

  it('cancels on escape when a handler is given', async () => {
    const onCancel = vi.fn()
    const { stdin } = render(<Select items={items} onSubmit={() => {}} onCancel={onCancel} />)
    stdin.write(ESCAPE)
    await settle()
    expect(onCancel).toHaveBeenCalled()
  })

  it('hides hints when asked, for narrow terminals', () => {
    const { lastFrame } = render(<Select items={items} onSubmit={() => {}} showHints={false} />)
    expect(lastFrame()).not.toContain('smaller, modern')
    expect(lastFrame()).toContain('WebP')
  })

  it('renders nothing rather than crashing on an empty list', () => {
    const { lastFrame } = render(<Select items={[]} onSubmit={() => {}} />)
    expect(lastFrame()).toBe('')
  })

  it('reports the highlighted index so a parent can preview it', async () => {
    const onHighlight = vi.fn()
    const { stdin } = render(<Select items={items} onSubmit={() => {}} onHighlight={onHighlight} />)
    stdin.write(DOWN)
    await settle()
    expect(onHighlight).toHaveBeenLastCalledWith(1)
    stdin.write(UP)
    await settle()
    expect(onHighlight).toHaveBeenLastCalledWith(0)
  })
})
