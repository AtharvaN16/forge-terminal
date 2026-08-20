import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import type { Choice } from '../../src/core/actions/index.js'
import { Select } from '../../src/shell/components/Select.js'

/**
 * Chalk (via Ink) reads colour-support once, when its module graph first
 * loads — a later `process.env.FORCE_COLOR = ...` inside a test body is too
 * late to matter. `vi.hoisted` is hoisted above the imports above, so this
 * runs before `ink-testing-library` (and therefore Ink and chalk) load,
 * which is the only point at which setting it has any effect.
 */
vi.hoisted(() => {
  process.env.FORCE_COLOR = '1'
})

const ESC = String.fromCharCode(27)
const DOWN = `${ESC}[B`
const UP = `${ESC}[A`
const ENTER = String.fromCharCode(13)
const ESCAPE = ESC
const BOLD_ON = `${ESC}[1m`

const items: Choice[] = [
  { value: 'webp', label: 'WebP', hint: 'smaller, modern' },
  { value: 'png', label: 'PNG', hint: 'lossless' },
  { value: 'avif', label: 'AVIF', hint: 'smallest' },
]

const settle = () => new Promise((r) => setTimeout(r, 60))

/**
 * The frame with SGR sequences removed. The cursor glyph and the label are
 * drawn as separately coloured spans — amber marker, bright label — so a
 * reset sequence sits between them in the raw output. Asserting on the
 * stripped text keeps these tests about *what the row says*, which is the
 * actual requirement, and leaves them indifferent to how it is styled.
 * Colour itself is still pinned below, via the bold sequence.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching SGR escapes is the point
const ANSI = /\u001b\[[0-9;]*m/g
const plain = (frame: string | undefined) => (frame ?? '').replace(ANSI, '')

describe('Select', () => {
  it('marks the first item with a cursor and bold, not colour alone', () => {
    const { lastFrame } = render(<Select width={60} items={items} onSubmit={() => {}} />)
    const frame = lastFrame() ?? ''
    expect(plain(frame)).toContain('❯ WebP')
    expect(plain(frame)).toContain('  PNG')
    // The glyph alone isn't the requirement — §13 demands bold too, so pin
    // the actual SGR bold-on sequence to the selected row and nowhere else.
    const lines = frame.split('\n')
    const selectedLine = lines[0] ?? ''
    const unselectedLine = lines[1] ?? ''
    expect(selectedLine).toContain(BOLD_ON)
    expect(unselectedLine).not.toContain(BOLD_ON)
  })

  it('shows each choice hint', () => {
    const { lastFrame } = render(<Select width={60} items={items} onSubmit={() => {}} />)
    expect(lastFrame()).toContain('smaller, modern')
  })

  it('moves the cursor down', async () => {
    const { stdin, lastFrame } = render(<Select width={60} items={items} onSubmit={() => {}} />)
    stdin.write(DOWN)
    await settle()
    expect(plain(lastFrame())).toContain('❯ PNG')
  })

  it('moves the cursor up', async () => {
    const { stdin, lastFrame } = render(<Select width={60} items={items} onSubmit={() => {}} />)
    stdin.write(DOWN)
    await settle()
    stdin.write(UP)
    await settle()
    expect(plain(lastFrame())).toContain('❯ WebP')
  })

  it('stops at the ends rather than wrapping', async () => {
    const { stdin, lastFrame } = render(<Select width={60} items={items} onSubmit={() => {}} />)
    stdin.write(UP)
    await settle()
    expect(plain(lastFrame())).toContain('❯ WebP')
    stdin.write(DOWN + DOWN + DOWN + DOWN)
    await settle()
    expect(plain(lastFrame())).toContain('❯ AVIF')
  })

  it('submits the highlighted value on enter', async () => {
    const onSubmit = vi.fn()
    const { stdin } = render(<Select width={60} items={items} onSubmit={onSubmit} />)
    stdin.write(DOWN)
    await settle()
    stdin.write(ENTER)
    await settle()
    expect(onSubmit).toHaveBeenCalledWith('png')
  })

  it('submits what the frame shows after a burst of keys in one flush', async () => {
    // A single stdin.write() can deliver several presses before React gets
    // a chance to re-render. Enter must act on wherever the cursor actually
    // lands, not on the index that was current when this render's input
    // handler closure was created.
    const onSubmit = vi.fn()
    const { stdin, lastFrame } = render(<Select width={60} items={items} onSubmit={onSubmit} />)
    stdin.write(DOWN + DOWN + ENTER)
    await settle()
    expect(plain(lastFrame())).toContain('❯ AVIF')
    expect(onSubmit).toHaveBeenCalledWith('avif')
  })

  it('ignores arrows and enter while inactive', async () => {
    const onSubmit = vi.fn()
    const onHighlight = vi.fn()
    const { stdin, lastFrame } = render(
      <Select
        width={60}
        items={items}
        onSubmit={onSubmit}
        onHighlight={onHighlight}
        isActive={false}
      />,
    )
    stdin.write(DOWN)
    await settle()
    stdin.write(ENTER)
    await settle()
    expect(plain(lastFrame())).toContain('❯ WebP')
    expect(onHighlight).not.toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('cancels on escape when a handler is given', async () => {
    const onCancel = vi.fn()
    const { stdin } = render(
      <Select width={60} items={items} onSubmit={() => {}} onCancel={onCancel} />,
    )
    stdin.write(ESCAPE)
    await settle()
    expect(onCancel).toHaveBeenCalled()
  })

  it('hides hints when asked, for narrow terminals', () => {
    const { lastFrame } = render(
      <Select width={60} items={items} onSubmit={() => {}} showHints={false} />,
    )
    expect(lastFrame()).not.toContain('smaller, modern')
    expect(lastFrame()).toContain('WebP')
  })

  it('renders nothing rather than crashing on an empty list', () => {
    const { lastFrame } = render(<Select width={60} items={[]} onSubmit={() => {}} />)
    expect(lastFrame()).toBe('')
  })

  it('reports the highlighted index so a parent can preview it', async () => {
    const onHighlight = vi.fn()
    const { stdin } = render(
      <Select width={60} items={items} onSubmit={() => {}} onHighlight={onHighlight} />,
    )
    stdin.write(DOWN)
    await settle()
    expect(onHighlight).toHaveBeenLastCalledWith(1)
    stdin.write(UP)
    await settle()
    expect(onHighlight).toHaveBeenLastCalledWith(0)
  })
})

/**
 * The pdf hub dims a row whose `appliesTo` is false rather than hiding it —
 * "needs 2+ files" only teaches anything if Merge is still on screen. That
 * needs the cursor to treat a disabled row as not there: skipped by the
 * arrows, never landed on at mount, never submittable.
 */
describe('Select disabled rows', () => {
  const withDisabled: Choice[] = [
    { value: 'merge', label: 'Merge', hint: 'needs 2+ files', disabled: true },
    { value: 'split', label: 'Split', hint: 'into several files' },
    { value: 'extract', label: 'Extract', hint: 'keep only some pages' },
  ]

  it('starts the cursor on the first enabled row, not row zero', () => {
    const { lastFrame } = render(<Select width={60} items={withDisabled} onSubmit={() => {}} />)
    expect(plain(lastFrame())).toContain('❯ Split')
  })

  it('skips a disabled row when moving down', async () => {
    const middleDisabled: Choice[] = [
      { value: 'split', label: 'Split', hint: 'a' },
      { value: 'merge', label: 'Merge', hint: 'needs 2+ files', disabled: true },
      { value: 'extract', label: 'Extract', hint: 'b' },
    ]
    const { stdin, lastFrame } = render(
      <Select width={60} items={middleDisabled} onSubmit={() => {}} />,
    )
    stdin.write(DOWN)
    await settle()
    expect(plain(lastFrame())).toContain('❯ Extract')
  })

  it('skips a disabled row when moving up', async () => {
    const middleDisabled: Choice[] = [
      { value: 'split', label: 'Split', hint: 'a' },
      { value: 'merge', label: 'Merge', hint: 'needs 2+ files', disabled: true },
      { value: 'extract', label: 'Extract', hint: 'b' },
    ]
    const { stdin, lastFrame } = render(
      <Select width={60} items={middleDisabled} onSubmit={() => {}} />,
    )
    stdin.write(DOWN)
    await settle()
    stdin.write(UP)
    await settle()
    expect(plain(lastFrame())).toContain('❯ Split')
  })

  it('never submits a disabled row', async () => {
    const onSubmit = vi.fn()
    const { stdin } = render(<Select width={60} items={withDisabled} onSubmit={onSubmit} />)
    stdin.write(UP) // already on the first enabled row; up is a no-op at the end
    await settle()
    stdin.write(ENTER)
    await settle()
    expect(onSubmit).toHaveBeenCalledWith('split')
  })

  it('renders a disabled row dim, without the cursor or bold', () => {
    const { lastFrame } = render(<Select width={60} items={withDisabled} onSubmit={() => {}} />)
    const frame = lastFrame() ?? ''
    const mergeLine = frame.split('\n').find((l) => plain(l).includes('Merge')) ?? ''
    expect(plain(mergeLine)).not.toContain('❯')
    expect(mergeLine).not.toContain(BOLD_ON)
  })

  it('still shows the reason in the margin for a disabled row', () => {
    const { lastFrame } = render(<Select width={60} items={withDisabled} onSubmit={() => {}} />)
    expect(plain(lastFrame())).toContain('needs 2+ files')
  })
})
