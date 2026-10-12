import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { formatBytes } from '../../src/core/units.js'
import { encodeToBuffer } from '../../src/engines/image.js'
import { probe } from '../../src/engines/registry.js'
import { App } from '../../src/shell/App.js'
import { makeGradientPng, makeTempDir } from '../helpers/fixtures.js'

const ESC = String.fromCharCode(27)
const ENTER = '\r'
const LEFT = `${ESC}[D`
const RIGHT = `${ESC}[C`
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms))
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')
const plain = (f: string | undefined) => (f ?? '').replace(SGR, '')
const lines = (f: string | undefined) => plain(f).split('\n')
const keyRow = (f: string | undefined) => lines(f).findLast((l) => l.trim() !== '') ?? ''
const sizeLine = (f: string | undefined) =>
  lines(f).find(
    (l) => /^ (?! ).*(smaller|larger|about the same|measuring)/.test(l) && !l.includes('sharper'),
  ) ?? ''

async function waitFor(lastFrame: () => string | undefined, ok: (f: string) => boolean) {
  const start = Date.now()
  while (!ok(plain(lastFrame())) && Date.now() - start < 10_000) await settle(30)
  return plain(lastFrame())
}

const prefsFor = (dir: string) => ({
  ...DEFAULT_PREFERENCES,
  theme: 'dark' as const,
  defaultOutput: dir,
})

/** A PNG at Quality, converting to JPEG (the first lossy target). */
async function atQuality() {
  const dir = await makeTempDir()
  const file = await makeGradientPng(dir, 'test.png', 200)
  const app = render(<App initialWidth={80} initialHeight={24} prefs={prefsFor(dir)} />)
  await settle()
  app.stdin.write(file)
  await settle()
  app.stdin.write(ENTER)
  await settle(400)
  app.stdin.write(ENTER) // JPEG, the first target for a PNG
  await settle(300)
  return { app, file }
}

/** What JPEG at `quality` really comes to, encoded the same way. */
async function realSize(file: string, quality: number) {
  const source = await probe(file)
  const bytes = await encodeToBuffer(source, 'jpeg', {
    background: '#ffffff',
    keepMetadata: false,
    quality,
  })
  return formatBytes(bytes.length)
}

describe('Quality', () => {
  it('titles the question and says what it is for, then the slider at the preference', async () => {
    const { app } = await atQuality()
    const frame = plain(app.lastFrame())
    expect(frame).toMatch(/^ Quality {40,}JPEG$/m)
    expect(frame).toMatch(/^ +80$/m)
    expect(frame).toMatch(/^ smaller {34}sharper$/m)
  })

  it('shows the measured size of the value it rests on, as an encode really made it', async () => {
    const { app, file } = await atQuality()
    const frame = await waitFor(app.lastFrame, (f) =>
      /smaller|larger|about the same/.test(sizeLine(f)),
    )
    const expected = await realSize(file, 80)
    expect(sizeLine(frame)).toMatch(
      new RegExp(`^ ${expected.replace('.', '\\.')}  (\\d+% (smaller|larger)|about the same)`),
    )
  })

  it('says measuring… while the new value is encoded, then its own size', async () => {
    const { app, file } = await atQuality()
    await waitFor(app.lastFrame, (f) => /smaller|larger|about the same/.test(sizeLine(f)))
    app.stdin.write(LEFT)
    await settle(60)
    expect(plain(app.lastFrame())).toMatch(/^ +75$/m)
    expect(sizeLine(app.lastFrame())).toMatch(/measuring/)
    const frame = await waitFor(app.lastFrame, (f) =>
      /smaller|larger|about the same/.test(sizeLine(f)),
    )
    expect(sizeLine(frame)).toContain(await realSize(file, 75))
  })

  it('remembers a size it has measured: back at 80 there is nothing to wait for', async () => {
    const { app, file } = await atQuality()
    await waitFor(app.lastFrame, (f) => /smaller|larger|about the same/.test(sizeLine(f)))
    app.stdin.write(LEFT)
    await waitFor(
      app.lastFrame,
      (f) => /75/.test(f) && /smaller|larger|about the same/.test(sizeLine(f)),
    )
    app.stdin.write(RIGHT)
    await settle(40)
    expect(sizeLine(app.lastFrame())).toContain(await realSize(file, 80))
  })

  it('keys: ←→ adjust and ↵ confirm, with mode, back and quit in the footnote', async () => {
    const { app } = await atQuality()
    const keys = keyRow(app.lastFrame())
    expect(keys).toMatch(/^ +←→ +adjust +↵ +confirm/)
    expect(keys).toMatch(/1–4 mode · esc back · ctrl-c quit$/)
  })
})
