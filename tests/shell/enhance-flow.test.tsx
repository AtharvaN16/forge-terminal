import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { CATALOG } from '../../src/extensions/catalog.js'
import type { ExtensionStatus } from '../../src/extensions/manager.js'
import { App } from '../../src/shell/App.js'
import type { EnhanceTools } from '../../src/shell/enhance.js'
import { fakeExtensions } from '../helpers/fake-extension.js'
import { makeTempDir } from '../helpers/fixtures.js'

const ESC = String.fromCharCode(27)
const DOWN = `${ESC}[B`
const ENTER = String.fromCharCode(13)
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms))
/** Polls for up to 30 s: the run spawns a real child, slow on a busy machine. */
const until = async (cond: () => boolean) => {
  for (let i = 0; i < 1200 && !cond(); i++) await new Promise((r) => setTimeout(r, 25))
}

const fake = fakeExtensions()
afterEach(() => fake.restore())

describe('enhance mode', () => {
  it('lists the four rows with the highlighted row’s details, installs a missing tool in place, then goes on to Save as and runs', async () => {
    const home = await fake.home()
    await fake.install(home, 'boost')
    const installed = new Set<string>(['boost'])
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => {
      release = r
    })
    const tools: EnhanceTools = {
      async list() {
        return CATALOG.map(
          (entry): ExtensionStatus => ({
            entry,
            ...(installed.has(entry.id) ? { installed: entry.version } : {}),
            updateAvailable: false,
            supported: true,
            downloadBytes: 32_489,
          }),
        )
      },
      async install(id, { onProgress }) {
        onProgress(16_000, 32_489)
        await gate
        await fake.install(home, id as 'remove-background')
        installed.add(id)
      },
    }

    // 4100 px wide: 2× fits, 4× would be 16,400 px, past the 16,384 px limit.
    const dir = await makeTempDir()
    const png = join(dir, 'banner.png')
    await sharp({ create: { width: 4100, height: 50, channels: 3, background: '#808080' } })
      .png()
      .toFile(png)

    const app = render(
      <App
        initialWidth={80}
        initialHeight={24}
        prefs={{ ...DEFAULT_PREFERENCES, theme: 'dark', defaultOutput: dir }}
        tools={tools}
      />,
    )
    const frame = () => app.lastFrame() ?? ''

    app.stdin.write('/enhance')
    await settle()
    app.stdin.write(ENTER)
    await settle()
    app.stdin.write(png)
    await until(() => frame().includes('banner.png'))
    app.stdin.write(ENTER)
    await until(() => frame().includes('Enhance PNG'))

    // At rest on Sharpen: only it says more. 4× is too large, dimmed with why.
    expect(frame()).toContain('same size · 4100 × 50')
    expect(frame()).toContain('Boost resolution 2×')
    expect(frame()).toContain('16,400 px, over 16,384')
    expect(frame()).not.toContain('8200 × 100')
    expect(frame()).toContain('Remove background')
    expect(frame()).not.toContain('default')

    await settle(300)
    app.stdin.write(DOWN)
    await until(() => frame().includes('8200 × 100'))
    expect(frame()).not.toContain('same size')

    // Down past the too-large row to Remove background, which is not installed.
    app.stdin.write(DOWN)
    await until(() => frame().includes('32.5 KB download · ↵ installs'))

    await settle(300)
    app.stdin.write(ENTER)
    await until(() => frame().includes('16.0 of 32.5 KB'))
    expect(frame()).toMatch(/esc +stop/)

    release()
    await until(() => frame().includes('Save as'))
    expect(frame()).toContain('banner-cutout')

    await settle(400) // let Save as's key handler attach
    app.stdin.write(ENTER)
    const out = join(dir, 'banner-cutout.png')
    await until(() => existsSync(out) && frame().includes('enhance another'))
    expect(frame()).toContain('banner-cutout.png')
    const meta = await sharp(out).metadata()
    expect([meta.width, meta.height, meta.hasAlpha]).toEqual([4100, 50, true])
  }, 120_000)
})
