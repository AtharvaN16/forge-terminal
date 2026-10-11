import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import stringWidth from 'string-width'
import { describe, expect, it, vi } from 'vitest'
import type { PathPreset } from '../../src/core/actions/index.js'
import { destinationRows, PathInput } from '../../src/shell/components/PathInput.js'
import { middleEllipsis } from '../../src/shell/width.js'
import { makeTempDir } from '../helpers/fixtures.js'

const ESC = String.fromCharCode(27)
const DOWN = `${ESC}[B`
const ENTER = String.fromCharCode(13)
const TAB = '\t'
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

describe('Save to, framed (spec 2026-10-11 picker §3)', () => {
  it('puts the question in the frame and counts the places', () => {
    const frame = render(<PathInput {...props()} />).lastFrame() ?? ''
    const lines = frame.split('\n')
    expect(lines[0]).toMatch(/^╭─ Save to ─+╮$/)
    expect(lines[1]).toContain('type to filter, or drop a file')
    expect(lines[1]).toContain('3/3')
    expect(lines[2]).toMatch(/^├─+┤$/)
    expect(frame).toContain('Same folder')
    expect(frame).toContain('New subfolder')
    expect(frame).toContain('Downloads')
    expect(frame).not.toContain('Type a path')
    expect(lines.at(-1)).toMatch(/^╰─+╯$/)
  })

  it('shows the resolved output on the highlighted place only', async () => {
    const { stdin, lastFrame } = render(<PathInput {...props()} />)
    expect(lastFrame()).toContain('/Users/me/Desktop/photo.webp')
    stdin.write(DOWN)
    await settle()
    expect(lastFrame()).toContain('/Users/me/Desktop/converted/photo.webp')
    expect(lastFrame()).not.toContain('/Users/me/Desktop/photo.webp')
  })

  it('tags the default place at the far end of its row, highlighted or not', () => {
    const frame =
      render(
        <PathInput {...props({ width: 70, defaultPath: '/Users/me/Downloads' })} />,
      ).lastFrame() ?? ''
    const row = frame.split('\n').find((l) => l.includes('Downloads')) ?? ''
    expect(row).toMatch(/★ default │$/)
  })

  it('submits the chosen place', async () => {
    const onSubmit = vi.fn()
    const { stdin } = render(<PathInput {...props({ onSubmit })} />)
    stdin.write(DOWN)
    await settle()
    stdin.write(ENTER)
    await settle()
    expect(onSubmit).toHaveBeenCalledWith('/Users/me/Desktop/converted')
  })

  it('narrows the places as you type', async () => {
    const onSubmit = vi.fn()
    const { stdin, lastFrame } = render(<PathInput {...props({ onSubmit })} />)
    stdin.write('do')
    await settle()
    const frame = lastFrame() ?? ''
    expect(frame).toContain('Downloads')
    expect(frame).not.toContain('Same folder')
    expect(frame).toContain('1/3')
    stdin.write(ENTER)
    await settle()
    expect(onSubmit).toHaveBeenCalledWith('/Users/me/Downloads')
  })

  it('no match keeps esc working, and enter does nothing', async () => {
    const onSubmit = vi.fn()
    const onCancel = vi.fn()
    const { stdin, lastFrame } = render(<PathInput {...props({ onSubmit, onCancel })} />)
    stdin.write('zzz')
    await settle()
    expect(lastFrame()).toContain('no match')
    expect(lastFrame()).toContain('0/3')
    stdin.write(ENTER)
    await settle()
    expect(onSubmit).not.toHaveBeenCalled()
    stdin.write(ESC)
    await settle()
    expect(lastFrame()).not.toContain('zzz')
    expect(onCancel).not.toHaveBeenCalled()
    stdin.write(ESC)
    await settle()
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('takes a typed folder as the place to save', async () => {
    const onSubmit = vi.fn()
    const { stdin, lastFrame } = render(<PathInput {...props({ onSubmit })} />)
    stdin.write('/Users/me/My\\ Folder')
    await settle()
    expect(lastFrame()).toContain('Use this folder')
    stdin.write(ENTER)
    await settle()
    expect(onSubmit).toHaveBeenCalledWith('/Users/me/My Folder')
  })

  it('classifies an escaped dropped file, and saves next to it', async () => {
    const dir = join(await makeTempDir(), 'x y')
    await mkdir(dir)
    await writeFile(join(dir, 'a.png'), 'png')
    const onSubmit = vi.fn()
    const { stdin, lastFrame } = render(<PathInput {...props({ onSubmit })} />)
    // What a drag from Finder pastes: the path, shell-escaped, in one chunk.
    stdin.write(join(dir, 'a.png').replace(/ /g, '\\ '))
    await settle()
    expect(lastFrame()).toContain('Next to a.png')
    stdin.write(ENTER)
    await settle()
    expect(onSubmit).toHaveBeenCalledWith(dir)
  })

  it('makes the highlighted place the default with tab', async () => {
    const onMakeDefault = vi.fn()
    const { stdin } = render(<PathInput {...props({ onMakeDefault })} />)
    stdin.write(DOWN)
    await settle()
    stdin.write(TAB)
    await settle()
    expect(onMakeDefault).toHaveBeenCalledWith('/Users/me/Desktop/converted')
  })

  it('does not offer a typed path as a default', async () => {
    const onMakeDefault = vi.fn()
    const { stdin } = render(<PathInput {...props({ onMakeDefault })} />)
    stdin.write('/tmp/somewhere')
    await settle()
    stdin.write(TAB)
    await settle()
    expect(onMakeDefault).not.toHaveBeenCalled()
  })

  it('submits the pasted path, not a stale place, when Enter lands before a redraw', async () => {
    // A drop and its Enter can both be read before React re-renders. The
    // list on screen is still the places then, and must not take the Enter.
    const onSubmit = vi.fn()
    const { stdin } = render(<PathInput {...props({ onSubmit })} />)
    stdin.write('/tmp/foo')
    stdin.write(ENTER)
    await settle()
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith('/tmp/foo')
  })

  it('cuts a long dropped file name to the frame rather than wrapping it', async () => {
    const dir = await makeTempDir()
    const name = 'Screenshot 2026-10-11 at 10.42.13 AM with a really long name.png'
    await writeFile(join(dir, name), 'png')
    const { stdin, lastFrame } = render(<PathInput {...props({ width: 40 })} />)
    stdin.write(join(dir, name).replace(/ /g, '\\ '))
    await settle()
    const lines = (lastFrame() ?? '').split('\n')
    expect(lines.filter((l) => l.includes('Next to')).length).toBe(1)
    expect(lines.length).toBe(5)
    for (const line of lines) expect(stringWidth(line)).toBeLessThanOrEqual(40)
  })

  it('submits the path without the CR when text and Enter arrive in one write', async () => {
    // Ink does not split a chunk containing both text and a line ending:
    // "/abc" + CR arrives as ONE event whose `input` is "/abc\r" and whose
    // `key.return` is false. A handler that only checks `key.return` would
    // never submit, and would append a raw \r to the buffer instead.
    const onSubmit = vi.fn()
    const { stdin } = render(<PathInput {...props({ onSubmit })} />)
    stdin.write(`/abc${ENTER}`)
    await settle()
    expect(onSubmit).toHaveBeenCalledWith('/abc')
  })

  it('submits the unescaped path when a dropped path with a trailing CR arrives in one write', async () => {
    const onSubmit = vi.fn()
    const { stdin } = render(<PathInput {...props({ onSubmit })} />)
    stdin.write(`/Users/me/My\\ Folder${ENTER}`)
    await settle()
    expect(onSubmit).toHaveBeenCalledWith('/Users/me/My Folder')
  })

  /**
   * Mouse support means this shell receives, on the same stdin channel as
   * typed text, a DSR reply to the cursor-position query and a press-and-
   * release pair for every click. Ink strips the leading ESC from anything
   * its parser could not resolve, so both arrive looking like text starting
   * with `[`. See `isStrayEscapeSequence` in `src/shell/mouse.ts`.
   */
  it('filters a DSR reply and a mouse report out of a typed path, without blocking legal brackets', async () => {
    const onSubmit = vi.fn()
    const { stdin } = render(<PathInput {...props({ onSubmit })} />)
    stdin.write('/tmp/a')
    await settle()
    stdin.write('\x1b[24;1R')
    await settle()
    stdin.write('\x1b[<0;12;34M')
    await settle()
    stdin.write('\x1b[<0;12;34m')
    await settle()
    stdin.write('shot[1].png')
    await settle()
    stdin.write(ENTER)
    await settle()
    expect(onSubmit).toHaveBeenCalledWith('/tmp/ashot[1].png')
  })

  it('never draws past the width it was given', () => {
    const deep: PathPreset[] = [
      { label: 'Same folder', path: '/Users/me/Documents/Projects/2026/Photography/Raw exports' },
    ]
    for (const width of [40, 55, 80]) {
      const sized = (path: string) => middleEllipsis(`${path}/photo.webp`, width - 4)
      const frame =
        render(
          <PathInput
            {...props({ presets: deep, width, preview: sized, defaultPath: deep[0]?.path ?? '' })}
          />,
        ).lastFrame() ?? ''
      for (const line of frame.split('\n')) expect(stringWidth(line)).toBeLessThanOrEqual(width)
      expect(frame).toContain('Same folder')
    }
  })

  it('drops the paths entirely when the caller says the band is compact', () => {
    const frame =
      render(<PathInput {...props({ width: 40, showHints: false })} />).lastFrame() ?? ''
    expect(frame).toContain('Same folder')
    expect(frame).not.toContain('/Users/me/Desktop')
    for (const line of frame.split('\n')) expect(stringWidth(line)).toBeLessThanOrEqual(40)
  })
})

describe('destinationRows', () => {
  it('lists every place for empty text, tagging the default', () => {
    const rows = destinationRows('', presets, '/Users/me/Downloads', preview)
    expect(rows.map((r) => r.label)).toEqual(['Same folder', 'New subfolder', 'Downloads'])
    expect(rows[2]?.badge).toBe('default')
  })

  it('treats ~ and / as a path, not a filter', () => {
    expect(destinationRows('~/out', presets, '', preview).map((r) => r.label)).toEqual([
      'Use this folder',
    ])
  })
})
