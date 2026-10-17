import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { render } from 'ink-testing-library'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { makeJpeg, makePng, makeTempDir } from '../helpers/fixtures.js'

const ENTER = String.fromCharCode(13)
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms))

let unmount: (() => void) | undefined
afterEach(() => {
  unmount?.()
  unmount = undefined
})

async function home(dir: string) {
  const r = render(
    <App
      initialWidth={80}
      initialHeight={24}
      prefs={{ ...DEFAULT_PREFERENCES, theme: 'dark', defaultOutput: dir }}
    />,
  )
  unmount = r.unmount
  const frame = () => r.lastFrame() ?? ''
  const until = async (ok: () => boolean, ms = 10_000) => {
    const end = Date.now() + ms
    while (!ok()) {
      if (Date.now() > end) throw new Error(`timed out on:\n${frame()}`)
      await settle(30)
    }
  }
  return { ...r, frame, until }
}

describe('a folder dropped in convert mode', () => {
  it('is one card on home, FOLDER – its name, and ↵ converts', async () => {
    const dir = await makeTempDir()
    await makePng(dir, 'a.png')
    await makeJpeg(dir, 'b.jpg')
    const app = await home(dir)
    app.stdin.write(dir)
    await app.until(() => app.frame().includes('FOLDER –'))
    expect(app.frame()).toContain(`FOLDER – ${basename(dir)}`)
    expect(app.frame()).toMatch(/2 images · /)
    expect(app.frame()).not.toContain('several files at once is coming')
    expect(app.frame()).toMatch(/↵.*convert/)
  })

  it('↵ walks the folder through to watching, under the header bar', async () => {
    const dir = await makeTempDir()
    await makePng(dir, 'a.png')
    await makeJpeg(dir, 'b.jpg')
    const app = await home(dir)
    app.stdin.write(dir)
    await app.until(() => app.frame().includes('FOLDER –'))
    await settle()
    app.stdin.write(ENTER)
    await app.until(() => app.frame().includes('Convert to'))
    expect(app.frame()).toMatch(/convert ╱+ Format/)
    app.stdin.write(ENTER)
    await app.until(() => app.frame().includes('Quality'))
    await settle()
    app.stdin.write(ENTER)
    await app.until(() => app.frame().includes('Save as'))
    await settle()
    app.stdin.write(ENTER)
    await app.until(() => /WebP ╱ 80 ╱ Same location ╱ Watching/.test(app.frame()))
    expect(existsSync(join(dir, 'a.webp'))).toBe(true)
    // No folder card over the watching screen: Done's bar is there instead.
    expect(app.frame()).not.toContain('FOLDER –')
    await settle()
    app.stdin.write(ENTER)
    await app.until(() => app.frame().toLowerCase().includes('drop a file'))
  })
})
