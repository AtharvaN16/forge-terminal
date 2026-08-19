import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { App } from '../../src/shell/App.js'
import { makeJpeg, makeTempDir } from '../helpers/fixtures.js'

const ESC = String.fromCharCode(27)
const DOWN = `${ESC}[B`
const ENTER = String.fromCharCode(13)
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
})
