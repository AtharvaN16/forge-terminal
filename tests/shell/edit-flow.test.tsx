import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { extensionDownloadFailed } from '../../src/core/errors.js'
import { boostScales } from '../../src/core/extension-targets.js'
import {
  assetFor,
  CATALOG,
  type CatalogEntry,
  catalogEntry,
  offeredOn,
} from '../../src/extensions/catalog.js'
import type { ExtensionStatus } from '../../src/extensions/manager.js'
import { App } from '../../src/shell/App.js'
import type { EditTools } from '../../src/shell/edit.js'
import { fakeExtensions } from '../helpers/fake-extension.js'
import { makeTempDir } from '../helpers/fixtures.js'
import { pinPlatform } from '../helpers/platform.js'

const ESC = String.fromCharCode(27)
const DOWN = `${ESC}[B`
const RIGHT = `${ESC}[C`
const LEFT = `${ESC}[D`
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

/**
 * The version a fresh install of `entry` gets on the platform in force (read
 * at call time, so it follows a pin): the Mac's boost is Apple Silicon only.
 */
const shipped = (entry: CatalogEntry) =>
  assetFor(entry, process.platform, process.platform === 'darwin' ? 'arm64' : process.arch)?.version

/** `becomes W × H` for the 40 × 30 tile at `scale`. */
const tileAt = (scale: number) => `becomes ${40 * scale} × ${30 * scale}`

// The catalogue offers these extensions on macOS; see pinPlatform. The Boost
// row's block below pins the real platform back: Windows' scales, its names.
pinPlatform('darwin')
const fake = fakeExtensions()
afterEach(() => fake.restore())

describe('edit mode', () => {
  // Remove background is a Mac-only row, and pinned to darwin on a Windows
  // runner Save as would split a C:\ path the Mac way for its name. Windows'
  // install in place is the Boost row's test below.
  it.skipIf(REAL_PLATFORM === 'win32')(
    'lists the rows with the highlighted one’s details in a pane, installs a missing tool in place, then goes on to Save as and runs',
    async () => {
      const home = await fake.home()
      await fake.install(home, 'boost')
      const installed = new Set<string>(['boost'])
      let release: () => void = () => {}
      const gate = new Promise<void>((r) => {
        release = r
      })
      const tools: EditTools = {
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

      app.stdin.write('/edit')
      await settle()
      app.stdin.write(ENTER)
      await settle()
      app.stdin.write(typed(png))
      await until(() => frame().includes('banner.png'))
      app.stdin.write(ENTER)
      await until(() => frame().includes('Edit PNG'))

      // At rest on Sharpen: the rows are names, and the pane right of the line
      // says what the highlighted one does, beside it, then what it makes.
      const sharpenLine = frame()
        .split('\n')
        .find((l) => l.includes('Sharpen'))
      expect(sharpenLine).toMatch(/Sharpen +│ +Keeps the size\./)
      expect(frame()).toContain('on-device model')
      expect(frame()).toContain('same size · 4100 × 50')
      expect(frame()).toContain('Boost resolution')
      expect(frame()).not.toContain('8200 × 100')
      expect(frame()).toContain('Remove background')
      expect(frame()).not.toContain('default')

      // One Boost row: 4× is past 16,384 px here, so it is simply not offered.
      await settle(300)
      app.stdin.write(DOWN)
      await until(() => frame().includes('becomes 8200 × 100'))
      expect(frame()).toContain('Makes it bigger.')
      expect(frame()).toMatch(/Boost resolution +‹ 2× ›/)
      expect(frame()).not.toContain('16,400')
      expect(frame()).not.toContain('same size')

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
      await until(() => existsSync(out) && frame().includes('edit another'))
      expect(frame()).toContain('banner-cutout.png')
      const meta = await sharp(out).metadata()
      expect([meta.width, meta.height, meta.hasAlpha]).toEqual([4100, 50, true])
    },
    120_000,
  )

  /** The pinned platform's tools, those in `installed` installed; `install` is the test's. */
  const someTools = (install: EditTools['install'], installed: Set<string>): EditTools => ({
    async list() {
      return CATALOG.filter((entry) => offeredOn(entry)).map(
        (entry): ExtensionStatus => ({
          entry,
          ...(installed.has(entry.id) ? { installed: shipped(entry) } : {}),
          updateAvailable: false,
          supported: true,
          downloadBytes: 32_489,
        }),
      )
    },
    install,
  })

  /** /edit, a small PNG, and the cursor on Remove background (not installed). */
  async function atRemoveBackground(tools: EditTools) {
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
    app.stdin.write('/edit')
    await settle()
    app.stdin.write(ENTER)
    await settle()
    app.stdin.write(typed(png))
    await until(() => frame().includes('tile.png'))
    app.stdin.write(ENTER)
    await until(() => frame().includes('Edit PNG'))
    await settle(300)
    // Sharpen, Boost resolution, then Remove background (Trim and Resize follow).
    for (let i = 0; i < 2; i++) {
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
    // The list's keys attach in an effect after the frame that shows it ready:
    // a key sent in between is dropped, as with Save as's handler elsewhere.
    await settle(300)
    app.stdin.write(`${ESC}[A`)
    await until(() => frame().includes('80 × 60'))
    expect(frame()).toContain('becomes 80 × 60')
  }, 60_000)

  // Boost is on both OSes, so these run on the real one: a fresh install is
  // 1.0.0 on a Mac (2×, 4×) and 1.1.0 on Windows (2×, 3×, 4×).
  describe('the Boost row, on this OS', () => {
    pinPlatform(REAL_PLATFORM)

    it('installing from the Boost row stays on the picker, so the scale can be chosen', async () => {
      const version = shipped(catalogEntry('boost') as CatalogEntry)
      const [, next] = boostScales(version)
      const installed = new Set<string>(['remove-background'])
      // Returns what the manager's install does: the version now on disk,
      // which the row's scales are read from.
      const tools = someTools(async (id, { onProgress }) => {
        onProgress(32_489, 32_489)
        installed.add(id)
        return { version }
      }, installed)
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
      app.stdin.write('/edit')
      await settle()
      app.stdin.write(ENTER)
      await settle()
      app.stdin.write(typed(png))
      await until(() => frame().includes('tile.png'))
      app.stdin.write(ENTER)
      await until(() => frame().includes('Edit PNG'))
      await settle(300)
      app.stdin.write(DOWN)
      await until(() => frame().includes('Makes it bigger.'))
      expect(frame()).toContain('32.5 KB download · ↵ installs')

      app.stdin.write(ENTER)
      await until(() => frame().includes('‹ 2× ›'))
      expect(frame()).toContain('becomes 80 × 60')
      expect(frame()).not.toContain('Save as')

      await settle(300) // ←→ attach once Boost shows its pill
      app.stdin.write(RIGHT)
      await until(() => frame().includes(tileAt(next as number)))
      app.stdin.write(ENTER)
      await until(() => frame().includes('Save as'))
      expect(frame()).toContain(`tile-${next}x`)
    }, 60_000)

    it('offers 3× on the Boost row when boost 1.1.0 is installed', async () => {
      const tools: EditTools = {
        async list() {
          return CATALOG.filter((entry) => offeredOn(entry)).map(
            (entry): ExtensionStatus => ({
              entry,
              installed: entry.id === 'boost' ? '1.1.0' : shipped(entry),
              updateAvailable: false,
              supported: true,
            }),
          )
        },
        async install() {},
      }
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
      app.stdin.write('/edit')
      await settle()
      app.stdin.write(ENTER)
      await settle()
      app.stdin.write(typed(png))
      await until(() => frame().includes('tile.png'))
      app.stdin.write(ENTER)
      await until(() => frame().includes('Edit PNG'))
      await settle(300)
      app.stdin.write(DOWN)
      await until(() => frame().includes('becomes 80 × 60'))
      await settle(300) // ←→ attach once Boost shows its pill
      app.stdin.write(RIGHT)
      await until(() => frame().includes('becomes 120 × 90'))
      expect(frame()).toContain('‹ 3× ›')
      app.stdin.write(ENTER)
      await until(() => frame().includes('Save as'))
      expect(frame()).toContain('tile-3x')
    }, 60_000)

    it('steps the Boost row’s scale with ←→ and answers with the one chosen', async () => {
      // On disk and in the list alike, the build this OS ships.
      const version = shipped(catalogEntry('boost') as CatalogEntry)
      const scales = boostScales(version)
      const home = await fake.home()
      await fake.install(home, 'boost', version)
      const tools = someTools(async () => {}, new Set(['boost', 'remove-background']))
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
      app.stdin.write('/edit')
      await settle()
      app.stdin.write(ENTER)
      await settle()
      app.stdin.write(typed(png))
      await until(() => frame().includes('tile.png'))
      app.stdin.write(ENTER)
      await until(() => frame().includes('Edit PNG'))
      await settle(300)

      // Sharpen has no scale: no ←→ in the keys.
      expect(frame()).not.toMatch(/←→ +scale/)
      app.stdin.write(DOWN)
      await until(() => frame().includes('becomes 80 × 60'))
      expect(frame()).toMatch(/←→ +scale/)

      await settle(300) // ←→ attach once Boost shows its pill
      for (const scale of scales.slice(1)) {
        app.stdin.write(RIGHT)
        await until(() => frame().includes(tileAt(scale)))
      }
      expect(frame()).toContain('‹ 4× ›')
      app.stdin.write(RIGHT) // already the largest: stays
      await settle(100)
      expect(frame()).toContain('becomes 160 × 120')
      app.stdin.write(LEFT)
      await until(() => frame().includes(tileAt(scales.at(-2) as number)))
      app.stdin.write(RIGHT)
      await until(() => frame().includes('becomes 160 × 120'))

      app.stdin.write(ENTER)
      await until(() => frame().includes('Save as'))
      expect(frame()).toContain('tile-4x')
      // The trail answers with the scale too, as the two rows used to.
      expect(frame()).toContain('Boost resolution 4×')

      // Back from Save as (esc clears the name, esc again goes back): the
      // picker is where it was, Boost at 4×.
      await settle(400)
      app.stdin.write(ESC)
      await settle()
      app.stdin.write(ESC)
      await until(() => frame().includes('Edit PNG'))
      await settle(200)
      expect(frame()).toMatch(/▌ Boost resolution +‹ 4× ›/)
      expect(frame()).toContain('becomes 160 × 120')

      // And the run itself is at 4× (the stand-in runner resizes by --scale).
      app.stdin.write(ENTER)
      await until(() => frame().includes('Save as'))
      await settle(400)
      app.stdin.write(ENTER)
      const out = join(dir, 'tile-4x.png')
      await until(() => existsSync(out) && frame().includes('edit another'))
      const meta = await sharp(out).metadata()
      expect([meta.width, meta.height]).toEqual([160, 120])
    }, 90_000)
  })

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
