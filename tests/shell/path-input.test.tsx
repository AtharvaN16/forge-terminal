import { render } from 'ink-testing-library'
import stringWidth from 'string-width'
import { describe, expect, it, vi } from 'vitest'
import type { PathPreset } from '../../src/core/actions.js'
import { PathInput } from '../../src/shell/components/PathInput.js'
import { middleEllipsis } from '../../src/shell/width.js'

const ESC = String.fromCharCode(27)
const DOWN = `${ESC}[B`
const ENTER = String.fromCharCode(13)
const settle = () => new Promise((r) => setTimeout(r, 60))

const presets: PathPreset[] = [
  { label: 'Same folder', path: '/Users/me/Desktop' },
  { label: 'New subfolder', path: '/Users/me/Desktop/converted' },
  { label: 'Downloads', path: '/Users/me/Downloads' },
]

const preview = (p: string) => `${p}/photo.webp`

/** Wide enough that nothing truncates unless a test asks for it. */
function props(over: Partial<Parameters<typeof PathInput>[0]> = {}) {
  return {
    label: 'Save to',
    presets,
    preview,
    onSubmit: () => {},
    width: 120,
    showHints: true,
    // No preset matches, so no row is tagged unless a test asks for it.
    defaultPath: '/nowhere-in-particular',
    ...over,
  }
}

describe('PathInput', () => {
  it('lists the presets plus a typing option', () => {
    const frame = render(<PathInput {...props()} />).lastFrame() ?? ''
    expect(frame).toContain('Same folder')
    expect(frame).toContain('New subfolder')
    expect(frame).toContain('Downloads')
    expect(frame).toContain('Type a path')
  })

  it('shows the resolved output for the highlighted preset', () => {
    const frame = render(<PathInput {...props()} />).lastFrame() ?? ''
    expect(frame).toContain('/Users/me/Desktop/photo.webp')
  })

  it('updates the preview as the highlight moves', async () => {
    const { stdin, lastFrame } = render(<PathInput {...props()} />)
    stdin.write(DOWN)
    await settle()
    expect(lastFrame()).toContain('/Users/me/Desktop/converted/photo.webp')
  })

  it('submits the chosen preset path', async () => {
    const onSubmit = vi.fn()
    const { stdin } = render(<PathInput {...props({ onSubmit })} />)
    stdin.write(DOWN)
    await settle()
    stdin.write(ENTER)
    await settle()
    expect(onSubmit).toHaveBeenCalledWith('/Users/me/Desktop/converted')
  })

  it('switches to a text field when the typing option is chosen', async () => {
    const { stdin, lastFrame } = render(<PathInput {...props()} />)
    stdin.write(DOWN + DOWN + DOWN)
    await settle()
    stdin.write(ENTER)
    await settle()
    expect(lastFrame()).toContain('›')
  })

  it('unescapes a dropped path typed into the field', async () => {
    const onSubmit = vi.fn()
    const { stdin } = render(<PathInput {...props({ onSubmit })} />)
    stdin.write(DOWN + DOWN + DOWN)
    await settle()
    stdin.write(ENTER)
    await settle()
    stdin.write('/Users/me/My\\ Folder')
    await settle()
    stdin.write(ENTER)
    await settle()
    expect(onSubmit).toHaveBeenCalledWith('/Users/me/My Folder')
  })

  it('submits the text without the CR when text and Enter arrive in one write', async () => {
    // Ink does not split a chunk containing both text and a line ending:
    // "abc" + CR arrives as ONE event whose `input` is "abc\r" and whose
    // `key.return` is false. A handler that only checks `key.return` would
    // never submit, and would append a raw \r to the buffer instead.
    const onSubmit = vi.fn()
    const { stdin } = render(<PathInput {...props({ onSubmit })} />)
    stdin.write(DOWN + DOWN + DOWN)
    await settle()
    stdin.write(ENTER)
    await settle()
    stdin.write(`abc${ENTER}`)
    await settle()
    expect(onSubmit).toHaveBeenCalledWith('abc')
  })

  it('submits the unescaped path when a dropped path with a trailing CR arrives in one write', async () => {
    // The realistic drag-and-drop-with-newline case: a path copied from a
    // file listing, editor, or multi-line selection carries a trailing
    // newline, so the pasted path and the terminal's Enter land in the same
    // chunk.
    const onSubmit = vi.fn()
    const { stdin } = render(<PathInput {...props({ onSubmit })} />)
    stdin.write(DOWN + DOWN + DOWN)
    await settle()
    stdin.write(ENTER)
    await settle()
    stdin.write(`/Users/me/My\\ Folder${ENTER}`)
    await settle()
    expect(onSubmit).toHaveBeenCalledWith('/Users/me/My Folder')
  })

  /**
   * A preset's hint is its absolute path, and absolute paths are routinely
   * longer than the terminal. Unbudgeted, they overflowed at 40, 55 and 80
   * columns — measured on the real destination step. Spec §13: truncate with
   * a middle ellipsis, never wrap, never overflow.
   */
  it('truncates preset hints to fit the terminal', () => {
    const deep: PathPreset[] = [
      { label: 'Same folder', path: '/Users/me/Documents/Projects/2026/Photography/Raw exports' },
    ]
    // The preview is the caller's to size (App.tsx budgets it against the
    // same width); this mirrors what it does, so the assertion below is
    // measuring the hints.
    const sized = (path: string) => middleEllipsis(`${path}/photo.webp`, 55 - 4)
    const frame =
      render(<PathInput {...props({ presets: deep, width: 55, preview: sized })} />).lastFrame() ??
      ''
    for (const line of frame.split('\n')) expect(stringWidth(line)).toBeLessThanOrEqual(55)
    expect(frame).toContain('…')
    expect(frame).toContain('Same folder')
  })

  it('drops the hints entirely when the caller says the band is compact', () => {
    const frame =
      render(<PathInput {...props({ width: 40, showHints: false })} />).lastFrame() ?? ''
    expect(frame).toContain('Same folder')
    expect(frame).not.toContain('/Users/me/Desktop\n')
    for (const line of frame.split('\n')) expect(stringWidth(line)).toBeLessThanOrEqual(40)
  })
})
