import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { App } from '../../src/shell/App.js'
import { makeJpeg, makeTempDir } from '../helpers/fixtures.js'

const ESC = String.fromCharCode(27)
const DOWN = `${ESC}[B`
const ENTER = String.fromCharCode(13)
const BACKSPACE = String.fromCharCode(127)
const settle = (ms = 120) => new Promise((r) => setTimeout(r, ms))

describe('shell flow', () => {
  it('starts by asking for a file', () => {
    const frame = render(<App initialWidth={80} />).lastFrame() ?? ''
    expect(frame.toLowerCase()).toContain('drop a file')
  })

  it('probes a typed path and shows what the file is', async () => {
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'photo.jpg')
    const { stdin, lastFrame } = render(<App initialWidth={80} />)
    stdin.write(jpg)
    await settle()
    stdin.write(ENTER)
    await settle(300)
    const frame = lastFrame() ?? ''
    expect(frame).toContain('photo.jpg')
    expect(frame).toContain('JPEG')
  })

  it('offers targets derived from the file, never a fixed list, and never heic', async () => {
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'photo.jpg')
    const { stdin, lastFrame } = render(<App initialWidth={80} />)
    stdin.write(jpg)
    await settle()
    stdin.write(ENTER)
    await settle(300)
    const frame = lastFrame() ?? ''
    expect(frame).toContain('Convert to')
    expect(frame).toContain('WebP')
    expect(frame).toContain('PNG')
    expect(frame).not.toContain('HEIC')
  })

  it('reports a bad path as a readable error and stays usable', async () => {
    const { stdin, lastFrame } = render(<App initialWidth={80} />)
    stdin.write('/definitely/not/here.jpg')
    await settle()
    stdin.write(ENTER)
    await settle(300)
    const frame = lastFrame() ?? ''
    expect(frame).toContain('✕')
    expect(frame).toContain('File not found')
    expect(frame.toLowerCase()).toContain('drop a file')
  })

  it('unescapes a dropped path with a space in it', async () => {
    const dir = await makeTempDir()
    await makeJpeg(dir, 'my photo.jpg')
    const { stdin, lastFrame } = render(<App initialWidth={80} />)
    stdin.write(`${dir}/my\\ photo.jpg`)
    await settle()
    stdin.write(ENTER)
    await settle(300)
    expect(lastFrame()).toContain('my photo.jpg')
  })

  it('shows a quality slider after choosing a lossy target', async () => {
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'photo.jpg')
    const { stdin, lastFrame } = render(<App initialWidth={80} />)
    stdin.write(jpg)
    await settle()
    stdin.write(ENTER)
    await settle(300)
    stdin.write(DOWN + DOWN) // targets are ordered jpeg, png, webp… so reach webp
    await settle()
    stdin.write(ENTER)
    await settle()
    expect(lastFrame()).toContain('Quality')
  })

  it('skips the quality slider for a lossless target', async () => {
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'photo.jpg')
    const { stdin, lastFrame } = render(<App initialWidth={80} />)
    stdin.write(jpg)
    await settle()
    stdin.write(ENTER)
    await settle(300)
    stdin.write(DOWN) // move to png
    await settle()
    stdin.write(ENTER)
    await settle()
    const frame = lastFrame() ?? ''
    expect(frame).not.toContain('Quality')
    expect(frame).toContain('Save to')
  })

  /**
   * Ink does not split a chunk containing both text and a newline: a file
   * dropped on the terminal (or a path copied from a listing/editor with a
   * trailing newline) can land in the SAME stdin chunk as the Enter that
   * follows it. That single event has `input === "<path>\r"` (or `\n`) and
   * `key.return === false`. A handler that only checks `key.return` would
   * bake the raw line ending into the buffer and never submit — and this
   * never shows up in a test that writes the path and Enter separately (as
   * every other test above does), only in one that bursts them together in
   * a single `stdin.write()`.
   */
  it('submits a dropped path whose trailing newline arrives in the same write', async () => {
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'photo.jpg')
    const { stdin, lastFrame } = render(<App initialWidth={80} />)
    stdin.write(`${jpg}\n`)
    await settle(300)
    const frame = lastFrame() ?? ''
    expect(frame).toContain('photo.jpg')
    expect(frame).toContain('JPEG')
  })

  it('submits a dropped path whose trailing CR (the Enter key) arrives in the same write', async () => {
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'photo.jpg')
    const { stdin, lastFrame } = render(<App initialWidth={80} />)
    stdin.write(`${jpg}${ENTER}`)
    await settle(300)
    const frame = lastFrame() ?? ''
    expect(frame).toContain('photo.jpg')
    expect(frame).toContain('JPEG')
  })

  /**
   * `probe()` is real disk I/O (stat, access, then sharp reading the file's
   * header) and nothing moves `stage` off `'idle'` until it resolves, so the
   * Prompt stays mounted for the whole `await` and a second, different
   * submission can start a second, overlapping probe before the first
   * settles. This deliberately does NOT `settle()` between the two writes —
   * a real yield of even 1ms was measured (see the fix report) to let the
   * first probe finish and `stage` advance past `'idle'` before the second
   * write even happens, which would unmount the Prompt and make the second
   * write land on nothing. A genuine overlap requires both writes to occur
   * within the same stretch of synchronous script, exactly as a user
   * dropping a second file while the first is still probing would produce.
   *
   * The second write backspaces away the first path's text before typing
   * the second: with no yield in between, React has not re-rendered Prompt
   * yet, so its internal ref (the source of truth for what to submit — see
   * Prompt.tsx) still holds the first path's text. Typing the second path
   * over it without clearing it first would concatenate the two into a
   * path that exists nowhere on disk, which would test nothing about the
   * race. Backspacing acts on that same ref directly and so is not subject
   * to the same render-timing gap.
   */
  it('resolves a race between two submissions in favor of the later one', async () => {
    const dir = await makeTempDir()
    const first = await makeJpeg(dir, 'first.jpg')
    const second = await makeJpeg(dir, 'second.jpg')
    const { stdin, lastFrame } = render(<App initialWidth={80} />)
    stdin.write(`${first}${ENTER}`)
    stdin.write(BACKSPACE.repeat(first.length) + second + ENTER)
    await settle(400)
    const frame = lastFrame() ?? ''
    expect(frame).not.toContain('first.jpg')
    expect(frame.split('second.jpg').length - 1).toBe(1)
    expect(frame).toContain('Convert to')
  })
})
