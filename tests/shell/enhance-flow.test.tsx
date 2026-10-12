import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { extensionDownloadFailed } from '../../src/core/errors.js'
import { assetFor, CATALOG, offeredOn } from '../../src/extensions/catalog.js'
import type { ExtensionStatus } from '../../src/extensions/manager.js'
import { App } from '../../src/shell/App.js'
import type { EnhanceTools } from '../../src/shell/enhance.js'
import { fakeExtensions } from '../helpers/fake-extension.js'
import { makeTempDir } from '../helpers/fixtures.js'
import { pinPlatform } from '../helpers/platform.js'

const ESC = String.fromCharCode(27)
const DOWN = `${ESC}[B`
const ENTER = String.fromCharCode(13)
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms))
/** Polls for up to 30 s: the run spawns a real child, slow on a busy machine. */
const until = async (cond: () => boolean) => {
  for (let i = 0; i < 1200 && !cond(); i++) await new Promise((r) => setTimeout(r, 25))
}

/**
 * Pinned to darwin, the shell reads a typed path the Mac way, where `\`
 * escapes. Forward slashes name the same file on Windows and survive that.
 */
const REAL_PLATFORM = process.platform
const typed = (path: string) => (REAL_PLATFORM === 'win32' ? path.replaceAll('\\', '/') : path)

// The catalogue offers these extensions on macOS; see pinPlatform.
pinPlatform('darwin')
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
        return CATALOG.filter((entry) => offeredOn(entry, 'darwin')).map(
          (entry): ExtensionStatus => ({
            entry,
            ...(installed.has(entry.id)
              ? { installed: assetFor(entry, 'darwin', 'arm64')?.version }
              : {}),
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
    app.stdin.write(typed(png))
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

  /** Tools where only boost is installed; `install` is the test's. */
  const someTools = (install: EnhanceTools['install'], installed: Set<string>): EnhanceTools => ({
    async list() {
      return CATALOG.filter((entry) => offeredOn(entry, 'darwin')).map(
        (entry): ExtensionStatus => ({
          entry,
          ...(installed.has(entry.id)
            ? { installed: assetFor(entry, 'darwin', 'arm64')?.version }
            : {}),
          updateAvailable: false,
          supported: true,
          downloadBytes: 32_489,
        }),
      )
    },
    install,
  })

  /** /enhance, a small PNG, and the cursor on Remove background (not installed). */
  async function atRemoveBackground(tools: EnhanceTools) {
    const dir = await makeTempDir()
    const png = join(dir, 'tile.png')
    await sharp({ create: { width: 40, height: 30, channels: 3, background: '#808080' } })
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
    app.stdin.write(typed(png))
    await until(() => frame().includes('tile.png'))
    app.stdin.write(ENTER)
    await until(() => frame().includes('Enhance PNG'))
    await settle(300)
    for (let i = 0; i < 3; i++) {
      app.stdin.write(DOWN)
      await settle(60)
    }
    await until(() => frame().includes('32.5 KB download · ↵ installs'))
    return { app, frame }
  }

  it('esc while checking leaves the picker usable, the row saying what is really on disk', async () => {
    const installed = new Set<string>(['boost'])
    let finish: () => void = () => {}
    const tools = someTools(async (id, { onProgress }) => {
      onProgress(32_489, 32_489)
      // The stop lands after the swap: the tool ends up installed anyway.
      await new Promise<void>((r) => {
        finish = r
      })
      installed.add(id)
    }, installed)
    const { app, frame } = await atRemoveBackground(tools)

    app.stdin.write(ENTER)
    await until(() => frame().includes('checking'))
    app.stdin.write(ESC)
    await settle(100)
    finish()
    // Not stuck on "checking": the row is ready, and the picker moves again.
    await until(() => frame().includes('transparent PNG'))
    expect(frame()).not.toContain('checking')
    expect(frame()).not.toContain('Save as')
    // The ready row is drawn a moment before Ink re-attaches the picker's key
    // handler (an effect, after the frame); a key sent in that gap is dropped,
    // not queued. Nothing on screen marks the handler, so give it its turn.
    await settle(300)
    app.stdin.write(`${ESC}[A`)
    await until(() => frame().includes('4800 × 3600') || frame().includes('160 × 120'))
    expect(frame()).toContain('160 × 120')
  }, 60_000)

  it('a failed download from the picker says why, and the row offers the download again', async () => {
    const tools = someTools(
      async (id, { onProgress }) => {
        onProgress(1_000, 32_489)
        throw extensionDownloadFailed(id, 'could not reach github.com.')
      },
      new Set(['boost']),
    )
    const { app, frame } = await atRemoveBackground(tools)

    app.stdin.write(ENTER)
    await until(() => frame().includes('Download failed'))
    await until(() => frame().includes('32.5 KB download · ↵ installs'))
    expect(frame()).toContain('could not reach github.com')
  }, 60_000)
})
