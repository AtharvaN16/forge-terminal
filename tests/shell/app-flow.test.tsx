import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { App } from '../../src/shell/App.js'
import { makeJpeg, makeTempDir } from '../helpers/fixtures.js'

const ESC = String.fromCharCode(27)
const DOWN = `${ESC}[B`
const ENTER = String.fromCharCode(13)
/**
 * 250ms, matching the rest of the shell suite. This file used 120 — the
 * shortest sleep anywhere in `tests/shell/` — which made it the first thing
 * to fail whenever the machine was busy, with a different assertion each run.
 *
 * A longer sleep can only give the app MORE time to reach the state a test
 * already asserts, so it cannot turn a real failure green; it removes a
 * timing guess, not a check. The proper fix is a polling `waitFor`, but only
 * 2 of this file's 20 sleeps are the mechanical `settle`-then-assert shape —
 * the rest sit between keystrokes with no predicate to poll on and need a
 * decision per site.
 */
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms))

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
    expect(frame).toContain('Convert JPEG to')
    expect(frame).toContain('WebP')
    expect(frame).toContain('PNG')
    expect(frame).not.toContain('HEIC')
    // 'JPEG' should appear exactly twice: once in the file card, once in the
    // "Convert JPEG to" label — never as its own row in the picker below.
    expect(frame.split('JPEG').length - 1).toBe(2)
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

  /**
   * A plausible typo — an extra path segment tacked onto a real filename —
   * makes the underlying `stat` fail with ENOTDIR rather than ENOENT.
   * `probe()` (src/engines/image.ts) now maps that to a `ForgeError`
   * instead of letting a raw `Error` escape; and even if something the
   * engine layer didn't anticipate ever throws a non-ForgeError here,
   * `submitPath`'s catch (src/shell/App.tsx) must render it rather than
   * rethrow into an unhandled rejection nobody sees. This is the exact case
   * that used to leave the shell showing nothing at all, forever.
   */
  it('renders a visible error and stays usable when a typed path runs through a file', async () => {
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'photo.jpg')
    const { stdin, lastFrame } = render(<App initialWidth={80} />)
    stdin.write(`${jpg}/nope.jpg`)
    await settle()
    stdin.write(ENTER)
    await settle(300)
    const frame = lastFrame() ?? ''
    expect(frame).toContain('✕')
    expect(frame).toContain('Invalid path')
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
    // jpeg is excluded (same-format is a no-op), so targets are ordered
    // png, webp, avif… one DOWN from the default (png) reaches webp.
    stdin.write(DOWN)
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
    // png is already the default highlighted target — jpeg is excluded as
    // a same-format no-op, so no navigation is needed to reach it.
    stdin.write(ENTER)
    await settle()
    const frame = lastFrame() ?? ''
    expect(frame).not.toContain('Quality')
    expect(frame).toContain('Save as')
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
   * Two newline-terminated paths in the same tick, with no yield between
   * them, are two drops (docs/superpowers/specs/2026-10-11-forge-drop-zone-design.md).
   * Each read claims `requestId`, so the later one supersedes the earlier and
   * only it lands. This pins a parked ruling, not the spec's "a second paste
   * adds": a real drag cannot arrive inside one probe's latency, and a
   * terminal splitting one long paste is safe — its second chunk lands in a
   * field that already has text, and submits the whole of it.
   *
   * What it still guards from before the drop zone: the second write must not
   * concatenate onto the first (a path nobody typed, which once left the
   * shell silently stuck), and the result is exactly one file, never both.
   */
  it('keeps only the later of two drops delivered in the same tick', async () => {
    const dir = await makeTempDir()
    const first = await makeJpeg(dir, 'first.jpg')
    const second = await makeJpeg(dir, 'second.jpg')
    const { stdin, lastFrame } = render(<App initialWidth={80} />)
    stdin.write(`${first}${ENTER}`)
    stdin.write(`${second}${ENTER}`)
    await settle(400)
    const frame = lastFrame() ?? ''
    expect(frame).not.toContain('first.jpg')
    expect(frame.split('second.jpg').length - 1).toBe(1)
    // A pasted path ending in a line break is a drop: staged, on home.
    expect(frame).toContain('drop more, or type a path')
  })
})
