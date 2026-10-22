import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { makeJpeg, makeNoiseImage, makeTempDir } from '../helpers/fixtures.js'
import { unpaint } from '../helpers/unpaint.js'

const ESC = String.fromCharCode(27)
const ENTER = '\r'
const DOWN = `${ESC}[B`
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms))
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')
const plain = (f: string | undefined) => unpaint((f ?? '').replace(SGR, ''))
const barLine = (frame: string) =>
  plain(frame)
    .split('\n')
    .find((l) => l.includes('╱╱') && /convert|compress|pdf/.test(l)) ?? ''
/** Working is on screen: the bar's trail ends in its verb. */
const isWorking = (frame: string) => / Converting ╱╱$/.test(barLine(frame))

/** Every frame from now until `done` holds, sampled every 10 ms. */
async function framesUntil(lastFrame: () => string | undefined, done: (f: string) => boolean) {
  const frames: Array<{ at: number; frame: string }> = []
  const start = Date.now()
  for (;;) {
    const frame = plain(lastFrame())
    frames.push({ at: Date.now() - start, frame })
    if (done(frame) || Date.now() - start > 30_000) return frames
    await settle(10)
  }
}

const prefsFor = (dir: string) => ({
  ...DEFAULT_PREFERENCES,
  theme: 'dark' as const,
  defaultOutput: dir,
})

/** Drops `file`, picks `format` on Format, and takes every default after it, up to the last ↵. */
async function walkTo(file: string, dir: string, format: string) {
  const app = render(<App initialWidth={80} initialHeight={24} prefs={prefsFor(dir)} />)
  await settle()
  app.stdin.write(file)
  await settle()
  app.stdin.write(ENTER)
  await settle(400)
  for (let i = 0; i < 8 && !plain(app.lastFrame()).includes(`▌ ${format}`); i++) {
    app.stdin.write(DOWN)
    await settle(100)
  }
  app.stdin.write(ENTER) // the format
  await settle(300)
  // Quality, if the format asks; then Save as.
  for (let i = 0; i < 3 && !/Save as ╱╱$/.test(barLine(app.lastFrame() ?? '')); i++) {
    app.stdin.write(ENTER)
    await settle(300)
  }
  expect(barLine(app.lastFrame() ?? '')).toMatch(/Save as ╱╱$/)
  return app
}

describe('Working', () => {
  it('never appears for a job done in under 0.3 s: Save as goes straight to Done', async () => {
    const dir = await makeTempDir()
    const app = await walkTo(await makeJpeg(dir, 'test.jpg'), dir, 'PNG')
    app.stdin.write(ENTER)
    const frames = await framesUntil(app.lastFrame, (f) => f.includes('convert another'))
    expect(frames.at(-1)?.frame).toContain('convert another')
    expect(frames.some(({ frame }) => isWorking(frame))).toBe(false)
  }, 30_000)

  it('appears once a slow job has run 0.3 s: the bar ends in the verb, the line says the true phase', async () => {
    const dir = await makeTempDir()
    const app = await walkTo(await makeNoiseImage(dir, 'noise.png', 900), dir, 'AVIF')
    app.stdin.write(ENTER)
    const frames = await framesUntil(app.lastFrame, (f) => f.includes('convert another'))

    const working = frames.filter(({ frame }) => isWorking(frame))
    expect(working.length).toBeGreaterThan(0)
    // Not before 0.3 s; the frames before it keep the bar and the card.
    expect(working[0]?.at).toBeGreaterThanOrEqual(250)
    const before = frames.filter(({ at }) => at < 200)
    for (const { frame } of before) {
      expect(isWorking(frame)).toBe(false)
      expect(frame).toContain('noise.png')
    }

    const frame = working[0]?.frame ?? ''
    expect(barLine(frame)).toMatch(/ noise\.avif ╱ Converting ╱╱$/)
    expect(frame).toMatch(/^ {4}Encoding AVIF/m)
    // Nothing invented: no percentage, no list of phases.
    expect(frame).not.toMatch(/\d+%/)
    expect(frame).not.toMatch(/reading.*decoding/i)
    expect(frame).not.toContain('Converting…')
    // No footnote on the key row (2026-10-22): only what the keys do.
    expect(frame).not.toContain('nothing is saved')
    expect(frame.trimEnd().split('\n').at(-1)).toMatch(/^ {30,}ctrl-c quit$/)
  }, 30_000)

  it('leaves no Working behind once the job is done', async () => {
    const dir = await makeTempDir()
    const app = await walkTo(await makeNoiseImage(dir, 'noise.png', 900), dir, 'AVIF')
    app.stdin.write(ENTER)
    await framesUntil(app.lastFrame, (f) => f.includes('convert another'))
    await settle(200)
    expect(isWorking(plain(app.lastFrame()))).toBe(false)
    expect(plain(app.frames.join('\n'))).toMatch(/Converting ╱╱/)
  }, 30_000)
})

describe('Working, finding a size', () => {
  async function searching() {
    const dir = await makeTempDir()
    const file = await makeNoiseImage(dir, 'photo.jpg', 1400, 'jpeg')
    const app = render(<App initialWidth={80} initialHeight={24} prefs={prefsFor(dir)} />)
    await settle()
    app.stdin.write('/compress')
    await settle()
    app.stdin.write(ENTER)
    await settle()
    app.stdin.write(file)
    await settle()
    app.stdin.write(ENTER)
    await settle(400)
    app.stdin.write(DOWN) // To a target size
    await settle()
    app.stdin.write(ENTER)
    await settle(300)
    app.stdin.write('40kb')
    await settle()
    app.stdin.write(ENTER) // the size -> Save as
    await settle(300)
    app.stdin.write(ENTER) // runs
    const frames = await framesUntil(app.lastFrame, (f) => f.includes('Finding the right quality'))
    return { app, frame: frames.at(-1)?.frame ?? '' }
  }

  it('shows a dot per try and offers esc, with no "try n" text', async () => {
    const { frame } = await searching()
    expect(frame).toMatch(/^ {4}Finding the right quality/m)
    expect(frame).toMatch(/^ {4}(● )*(○ )*[●○]$/m)
    expect(frame).toMatch(/●/)
    expect(frame).not.toMatch(/try \d|attempt/)
    const keys = frame.split('\n').findLast((l) => l.trim() !== '') ?? ''
    expect(keys).toMatch(/esc +stop/)
    expect(keys).toMatch(/ctrl-c quit$/)
    expect(barLine(frame)).toMatch(/Compressing ╱╱$/)
  }, 30_000)

  it('esc stops the search and goes back to the size', async () => {
    const { app } = await searching()
    app.stdin.write(ESC)
    await settle(300)
    expect(barLine(app.lastFrame() ?? '')).toMatch(/Size ╱╱$/)
  }, 30_000)
})
