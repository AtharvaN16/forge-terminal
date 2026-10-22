import { readdir } from 'node:fs/promises'
import { render } from 'ink-testing-library'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { assetFor, CATALOG, offeredOn } from '../../src/extensions/catalog.js'
import type { ExtensionStatus } from '../../src/extensions/manager.js'
import { App } from '../../src/shell/App.js'
import type { EditTools } from '../../src/shell/edit.js'
import { fakeExtensions } from '../helpers/fake-extension.js'
import { makeTempDir } from '../helpers/fixtures.js'

const ESC = String.fromCharCode(27)
const DOWN = `${ESC}[B`
const ENTER = String.fromCharCode(13)
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms))

const fake = fakeExtensions()
afterEach(() => fake.restore())

const version = (id: string) => {
  const entry = CATALOG.find((e) => e.id === id)
  return entry ? assetFor(entry, process.platform, process.arch)?.version : undefined
}

describe('Boost resolution on several images', () => {
  it.skipIf(version('boost') === undefined)(
    'boosts each at the scale on the row, through the installed tool',
    async () => {
      const home = await fake.home()
      await fake.install(home, 'boost', version('boost'))
      const tools: EditTools = {
        async list() {
          return CATALOG.filter((e) => offeredOn(e, process.platform)).map(
            (entry): ExtensionStatus => ({
              entry,
              ...(entry.id === 'boost' ? { installed: version('boost') } : {}),
              updateAvailable: false,
              supported: true,
              downloadBytes: 1,
            }),
          )
        },
        async install() {},
      }
      const dir = await makeTempDir()
      const out = await makeTempDir()
      const paths: string[] = []
      for (const name of ['a.png', 'b.png']) {
        const path = `${dir}/${name}`
        await sharp({ create: { width: 40, height: 30, channels: 3, background: '#808080' } })
          .png()
          .toFile(path)
        paths.push(path)
      }
      const app = render(
        <App
          initialWidth={80}
          initialHeight={24}
          prefs={{ ...DEFAULT_PREFERENCES, theme: 'dark', defaultOutput: out }}
          tools={tools}
        />,
      )
      const frame = () => (app.lastFrame() ?? '').replace(SGR, '')
      const until = async (ok: () => boolean) => {
        for (let i = 0; i < 1200 && !ok(); i++) await settle(25)
        await settle(150)
      }
      await until(() => frame().includes('1 convert'))
      app.stdin.write('4')
      await settle(300)
      app.stdin.write(paths.join(' '))
      await until(() => frame().includes('2 images'))
      app.stdin.write(ENTER)
      await until(() => frame().includes('Edit 2 images'))
      app.stdin.write(DOWN)
      await until(() => /▌ +Boost resolution/.test(frame()))
      app.stdin.write(ENTER)
      await until(() => frame().includes('Save as'))
      expect(frame()).toMatch(/Boost resolution ╱ 2× ╱ Save as/)
      app.stdin.write(ENTER)
      await until(() => frame().includes('go home'))
      expect((await readdir(out)).sort()).toEqual(['a-2x.png', 'b-2x.png'])
      const meta = await sharp(`${out}/a-2x.png`).metadata()
      expect([meta.width, meta.height]).toEqual([80, 60])
      app.unmount()
    },
    40_000,
  )
})
