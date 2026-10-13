import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { CATALOG, offeredOn } from '../../src/extensions/catalog.js'
import type { ExtensionStatus } from '../../src/extensions/manager.js'
import { App } from '../../src/shell/App.js'
import type { EnhanceTools } from '../../src/shell/enhance.js'
import { fakeExtensions } from '../helpers/fake-extension.js'
import { makeTempDir } from '../helpers/fixtures.js'
import { pinPlatform } from '../helpers/platform.js'

const ESC = String.fromCharCode(27)
const DOWN = `${ESC}[B`
const ENTER = String.fromCharCode(13)
const ROWS = 24
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms))
const until = async (cond: () => boolean) => {
  for (let i = 0; i < 1200 && !cond(); i++) await new Promise((r) => setTimeout(r, 25))
}

/** A cutout that finds nothing to cut, as Apple Vision says of a book cover. */
const NO_SUBJECT = `console.log(JSON.stringify({ ok: false, code: 'no-subject', message: 'no subject' }))\n`

pinPlatform('darwin')
const fake = fakeExtensions()
afterEach(() => fake.restore())

/**
 * Home fills the window, so anything `<Static>` prints above it is already
 * off the top of the screen: a run that failed and went home used to leave
 * nothing on screen to say so. The E5 panel stays live on home instead,
 * under the drop zone and its field, and home makes room for it.
 */
describe('a run that fails and goes home', () => {
  it.skipIf(process.platform === 'win32')(
    'keeps its E5 panel on screen, under the drop zone, within the window',
    async () => {
      const home = await fake.home()
      await fake.install(home, 'remove-background')
      await writeFile(
        join(home, 'forge', 'extensions', 'remove-background', '1.0.0', 'runner.mjs'),
        NO_SUBJECT,
      )
      const tools: EnhanceTools = {
        async list() {
          return CATALOG.filter((entry) => offeredOn(entry, 'darwin')).map(
            (entry): ExtensionStatus => ({
              entry,
              ...(entry.id === 'remove-background' ? { installed: '1.0.0' } : {}),
              updateAvailable: false,
              supported: true,
              downloadBytes: 1,
            }),
          )
        },
        async install() {},
      }
      const dir = await makeTempDir()
      const png = join(dir, 'cover.png')
      await sharp({ create: { width: 40, height: 30, channels: 3, background: '#808080' } })
        .png()
        .toFile(png)

      const app = render(
        <App
          initialWidth={80}
          initialHeight={ROWS}
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
      await until(() => frame().includes('cover.png'))
      app.stdin.write(ENTER)
      await until(() => frame().includes('Enhance PNG'))
      await settle(300)
      app.stdin.write(DOWN)
      await settle(60)
      app.stdin.write(DOWN)
      await until(() => frame().includes('Keeps the subject.'))
      app.stdin.write(ENTER)
      await until(() => frame().includes('Save as'))
      await settle(400)
      app.stdin.write(ENTER)
      await until(() => frame().includes('Drop a file here'))
      await settle()

      // The live frame is the window's last ROWS lines; the panel is in them,
      // under the drop zone and its field, above the keys.
      const lines = frame().split('\n').slice(-ROWS)
      const live = lines.join('\n')
      expect(live).toMatch(/^\s+failed\s*$/m)
      expect(live).toContain('No subject found')
      expect(live).toContain('ctrl-c quit')
      const at = (re: RegExp) => lines.findIndex((l) => re.test(l))
      expect(at(/Drop a file here/)).toBeGreaterThan(-1)
      expect(at(/^\s+failed\s*$/)).toBeGreaterThan(at(/or type a path/))
      expect(at(/^\s+failed\s*$/)).toBeGreaterThan(at(/Drop a file here/))
      // Once, not live and in the scrollback both.
      expect(frame().match(/No subject found/g)).toHaveLength(1)

      // The next file starts fresh: the panel goes to the scrollback.
      app.stdin.write(png)
      await until(() => !frame().split('\n').slice(-ROWS).join('\n').includes('No subject'))
      expect(frame()).toContain('No subject found')
      expect(frame().match(/No subject found/g)).toHaveLength(1)
    },
    60_000,
  )
})
