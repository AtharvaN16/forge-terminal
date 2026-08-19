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
   * a real yield of even 1ms lets the first probe finish and `stage`
   * advance past `'idle'` before the second write even happens (a local
   * temp-file probe resolves in well under a millisecond), which unmounts
   * the Prompt and makes the second write land on nothing — that is
   * *first*-wins, correctly, because there was never a genuine second
   * submission. A genuine overlap — two Enter-terminated paths that both
   * actually reach `submitPath` — only exists with zero yield between the
   * writes, exactly as two paths pasted back to back, or two chunks
   * delivered in the same tick, would arrive.
   *
   * Ordinary, unmodified writes: no backspacing, no clearing trick needed.
   * `Prompt` resets its own buffer the instant it submits (see Prompt.tsx),
   * so the second write's text does not concatenate onto the first's.
   *
   * Before that fix, this exact test reached neither file: the second
   * write's characters landed on top of the still-unflushed first (React
   * hadn't re-rendered `Prompt` yet, so its ref still held the first path),
   * concatenating into a path nobody typed and that exists nowhere on disk.
   * `probe()` rejected that bogus path with a raw `ENOTDIR` — not a
   * `ForgeError`, since `engines/image.ts` only special-cases
   * ENOENT/EACCES/EPERM — which `submitPath` rethrew as an unhandled
   * promise rejection the UI never sees. Meanwhile the *first* probe, for a
   * perfectly real file, resolved successfully but was (correctly, by its
   * own logic) dropped as superseded, because the bogus second request had
   * already claimed the latest id. Net effect: no card, no error, the shell
   * silently and permanently stuck on the idle prompt. Confirmed with
   * `process.stderr` instrumentation on both `submitPath` and `Prompt`'s
   * handler — see the fix report for the literal trace.
   *
   * With the fix, both submissions are clean, so both probes resolve
   * successfully. The id ordering is deterministic here (not a coin flip):
   * the two writes are processed strictly in order by a single-threaded
   * event loop, so the second submission's `submitPath` call always claims
   * a strictly higher id than the first's, synchronously, before either one
   * awaits. Whichever probe resolves in whatever real order, the first
   * one's id is permanently stale by the time it settles, and the second's
   * is permanently current — so the second (later-issued) submission always
   * wins, cleanly. That is a different, and correct, contract from variants
   * where a real yield elapses: there, the "second" write never becomes a
   * submission at all, so of course the first stands.
   */
  it('resolves a race between two submissions delivered in the same tick', async () => {
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
    expect(frame).toContain('Convert to')
  })
})
