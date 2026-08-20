import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { makeJpeg, makePng, makeTempDir } from '../helpers/fixtures.js'

const ENTER = String.fromCharCode(13)
const DOWN = `${String.fromCharCode(27)}[B`
const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms))

/**
 * Enters the compress flow, then drops a file into it.
 *
 * `/compress` is typed at the prompt, which is where the palette lives —
 * once a file is staged the shell is showing a picker, not a prompt.
 */
async function toCompress(name = 'photo.jpg') {
  const dir = await makeTempDir()
  const file = await makeJpeg(dir, name)
  const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const, defaultOutput: dir }
  const app = render(<App initialWidth={100} prefs={prefs} />)
  app.stdin.write('/compress')
  await settle()
  app.stdin.write(ENTER)
  await settle(200)
  app.stdin.write(file)
  await settle()
  app.stdin.write(ENTER)
  await settle(500)
  return { ...app, dir }
}

/** Walks the remaining steps: destination, then name. */
async function finish(stdin: { write: (s: string) => void }) {
  stdin.write(ENTER)
  await settle()
  stdin.write(ENTER)
  await settle(1200)
}

describe('compress in the shell', () => {
  it('asks how to compress', async () => {
    const { lastFrame } = await toCompress()
    const frame = lastFrame() ?? ''
    expect(frame).toContain('By quality')
    expect(frame).toContain('To a target size')
  })

  it('compresses by quality and writes a suffixed file', async () => {
    const { stdin, dir } = await toCompress()
    stdin.write(ENTER) // By quality
    await settle()
    stdin.write(ENTER) // accept the slider
    await settle()
    await finish(stdin)

    const written = (await readdir(dir)).filter((f) => f !== 'photo.jpg')
    expect(written).toHaveLength(1)
    expect(written[0]).toContain('-small')
    expect(written[0]?.endsWith('.jpg')).toBe(true)
  }, 20_000)

  it('keeps the format — a compressed jpeg is still a jpeg', async () => {
    const { stdin, dir } = await toCompress()
    stdin.write(ENTER)
    await settle()
    stdin.write(ENTER)
    await settle()
    await finish(stdin)

    const written = (await readdir(dir)).find((f) => f.includes('-small'))
    const meta = await sharp(join(dir, written ?? '')).metadata()
    expect(meta.format).toBe('jpeg')
  }, 20_000)

  it('takes a target size and lands under it', async () => {
    const { stdin, dir } = await toCompress()
    stdin.write(DOWN) // To a target size
    await settle()
    stdin.write(ENTER)
    await settle()
    stdin.write('2kb')
    await settle()
    stdin.write(ENTER)
    await settle()
    await finish(stdin)

    const written = (await readdir(dir)).find((f) => f.includes('-small'))
    expect(written).toBeDefined()
    const { size } = await stat(join(dir, written ?? ''))
    expect(size).toBeLessThanOrEqual(2048)
  }, 30_000)

  it('rejects a size it cannot parse, in the field', async () => {
    const { stdin, lastFrame } = await toCompress()
    stdin.write(DOWN)
    await settle()
    stdin.write(ENTER)
    await settle()
    stdin.write('banana')
    await settle()
    stdin.write(ENTER)
    await settle(300)
    const frame = lastFrame() ?? ''
    // Still on the size step, and told why.
    expect(frame).toContain('Target size')
    expect(frame).toContain('not a size')
  }, 20_000)

  it('/compress on a lossless source says why it cannot', async () => {
    const dir = await makeTempDir()
    const png = await makePng(dir, 'flat.png')
    const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const, defaultOutput: dir }
    const { stdin, lastFrame, frames } = render(<App initialWidth={100} prefs={prefs} />)
    stdin.write('/compress')
    await settle()
    stdin.write(ENTER)
    await settle(200)
    stdin.write(png)
    await settle()
    stdin.write(ENTER)
    await settle(500)
    const all = frames.join('') + (lastFrame() ?? '')
    expect(all).toContain('Nothing to compress')
    expect(all.toLowerCase()).toContain('lossless')
  }, 20_000)

  it('leaves the convert flow untouched', async () => {
    // Dropping a file still means convert — the fastest path stays fastest.
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'photo.jpg')
    const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const, defaultOutput: dir }
    const { stdin, lastFrame } = render(<App initialWidth={100} prefs={prefs} />)
    stdin.write(jpg)
    await settle()
    stdin.write(ENTER)
    await settle(400)
    expect(lastFrame() ?? '').toContain('Convert JPEG to')
  }, 20_000)
})

describe('the format suggestion', () => {
  it('offers a stronger format after compressing, with a measured size', async () => {
    const { stdin, lastFrame, frames } = await toCompress()
    stdin.write(ENTER) // By quality
    await settle()
    stdin.write(ENTER) // accept the slider
    await settle()
    await finish(stdin)
    await settle(600)

    const all = frames.join('') + (lastFrame() ?? '')
    // WebP is the candidate for a JPEG. The number beside it came from an
    // actual encode, not an estimate.
    expect(all).toContain('WebP would be')
    expect(all).toMatch(/\d+% smaller again/)
  }, 30_000)

  it('offers a key to act on it', async () => {
    const { stdin, lastFrame, frames } = await toCompress()
    stdin.write(ENTER)
    await settle()
    stdin.write(ENTER)
    await settle()
    await finish(stdin)
    await settle(600)
    const all = frames.join('') + (lastFrame() ?? '')
    expect(all).toContain('convert to WebP')
  }, 30_000)

  it('says nothing after an ordinary conversion', async () => {
    // The suggestion belongs to compression: after /convert the user has
    // already chosen a format, and second-guessing it is noise.
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'photo.jpg')
    const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const, defaultOutput: dir }
    const { stdin, lastFrame, frames } = render(<App initialWidth={100} prefs={prefs} />)
    stdin.write(jpg)
    await settle()
    stdin.write(ENTER)
    await settle(400)
    stdin.write(DOWN) // webp
    await settle()
    stdin.write(ENTER)
    await settle()
    stdin.write(ENTER) // quality
    await settle()
    await finish(stdin)
    await settle(600)

    const all = frames.join('') + (lastFrame() ?? '')
    expect(all).not.toContain('would be')
  }, 30_000)
})
