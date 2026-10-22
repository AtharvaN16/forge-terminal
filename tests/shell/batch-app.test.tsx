import { existsSync } from 'node:fs'
import { mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { makeJpeg, makeNoiseImage, makeTempDir } from '../helpers/fixtures.js'

const ENTER = String.fromCharCode(13)
const DOWN = `${String.fromCharCode(27)}[B`
const SGR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms))

let unmount: (() => void) | undefined
afterEach(() => {
  unmount?.()
  unmount = undefined
})

/** The app at 80 × 24 in compress mode, saving into `out`. */
async function compressHome(out: string) {
  const r = render(
    <App
      initialWidth={80}
      initialHeight={24}
      prefs={{ ...DEFAULT_PREFERENCES, theme: 'dark', defaultOutput: out }}
    />,
  )
  unmount = r.unmount
  const frame = () => (r.lastFrame() ?? '').replace(SGR, '')
  const until = async (ok: () => boolean, ms = 15_000) => {
    const end = Date.now() + ms
    while (!ok()) {
      if (Date.now() > end) throw new Error(`timed out on:\n${frame()}`)
      await settle(30)
    }
    // Each screen's keys attach just after it draws.
    await settle(120)
  }
  await until(() => frame().includes('1 convert'))
  r.stdin.write('2')
  await settle(300)
  return { ...r, frame, until }
}

/** Three photos, heavy enough to compress. */
async function photos(dir: string) {
  return [
    await makeNoiseImage(dir, 'one.jpg', 220, 'jpeg'),
    await makeNoiseImage(dir, 'two.jpg', 240, 'jpeg'),
    await makeNoiseImage(dir, 'three.jpg', 260, 'jpeg'),
  ]
}

describe('several files in compress mode', () => {
  it('takes ↵ on home, asks once for all of them, and lists every file at Done', async () => {
    const dir = await makeTempDir()
    const out = await makeTempDir()
    const paths = await photos(dir)
    const app = await compressHome(out)
    app.stdin.write(paths.join(' '))
    await app.until(() => app.frame().includes('3 images'))
    expect(app.frame()).not.toContain('is coming')
    expect(app.frame()).toMatch(/↵ +compress/)

    app.stdin.write(ENTER)
    await app.until(() => app.frame().includes('Method'))
    expect(app.frame()).toContain('JPEG ×3')
    expect(app.frame()).toContain('pick a level')
    expect(app.frame()).not.toContain('see the result')
    app.stdin.write(ENTER)
    await app.until(() => app.frame().includes('smaller'))
    app.stdin.write(ENTER)
    await app.until(() => app.frame().includes('Save as'))
    expect(app.frame()).toContain('one-small.jpg … 3 files')
    app.stdin.write(ENTER)
    await app.until(() => app.frame().includes('go home'))

    const done = app.frame()
    expect(done).toContain('3 images')
    for (const name of ['one.jpg', 'two.jpg', 'three.jpg']) expect(done).toContain(name)
    expect(done).toMatch(/one\.jpg +\d.* → +\d.*−\d+%/)
    expect(done).not.toContain('Watching')
    expect((await readdir(out)).sort()).toEqual([
      'one-small.jpg',
      'three-small.jpg',
      'two-small.jpg',
    ])
  }, 40_000)

  it('to a target size: each file under it, and a file already under it left alone', async () => {
    const dir = await makeTempDir()
    const out = await makeTempDir()
    const paths = [...(await photos(dir)), await makeJpeg(dir, 'tiny.jpg')]
    const app = await compressHome(out)
    app.stdin.write(paths.join(' '))
    await app.until(() => app.frame().includes('4 images'))
    app.stdin.write(ENTER)
    await app.until(() => app.frame().includes('Method'))
    app.stdin.write(DOWN)
    await settle(150)
    app.stdin.write(ENTER)
    await app.until(() => app.frame().includes('Target size'))
    app.stdin.write('20kb')
    await settle(150)
    app.stdin.write(ENTER)
    await app.until(() => app.frame().includes('Save as'))
    app.stdin.write(ENTER)
    await app.until(() => app.frame().includes('go home'), 30_000)
    const done = app.frame()
    expect(done).toMatch(/tiny\.jpg +already under that size/)
    expect(existsSync(join(out, 'tiny-small.jpg'))).toBe(false)
    expect(existsSync(join(out, 'one-small.jpg'))).toBe(true)
  }, 60_000)

  it('asks once when some names are taken, and keep both numbers them', async () => {
    const dir = await makeTempDir()
    const out = await makeTempDir()
    const paths = await photos(dir)
    for (let round = 0; round < 2; round++) {
      const app = await compressHome(out)
      app.stdin.write(paths.join(' '))
      await app.until(() => app.frame().includes('3 images'))
      app.stdin.write(ENTER)
      await app.until(() => app.frame().includes('Method'))
      app.stdin.write(ENTER)
      await app.until(() => app.frame().includes('smaller'))
      app.stdin.write(ENTER)
      await app.until(() => app.frame().includes('Save as'))
      app.stdin.write(ENTER)
      if (round === 1) {
        await app.until(() => app.frame().includes('3 files already exist'))
        expect(app.frame()).toContain('one-small (1).jpg …')
        app.stdin.write(ENTER)
      }
      await app.until(() => app.frame().includes('go home'))
      unmount?.()
      unmount = undefined
    }
    expect((await readdir(out)).sort()).toEqual([
      'one-small (1).jpg',
      'one-small.jpg',
      'three-small (1).jpg',
      'three-small.jpg',
      'two-small (1).jpg',
      'two-small.jpg',
    ])
  }, 60_000)
})

describe('stopping a batch', () => {
  it('esc lets the files already started finish, starts no more, and says which stopped', async () => {
    const dir = await makeTempDir()
    const out = await makeTempDir()
    const paths: string[] = []
    for (let i = 0; i < 8; i++) paths.push(await makeNoiseImage(dir, `p${i}.jpg`, 900, 'jpeg'))
    const app = await compressHome(out)
    app.stdin.write(paths.join(' '))
    await app.until(() => app.frame().includes('8 images'))
    app.stdin.write(ENTER)
    await app.until(() => app.frame().includes('Method'))
    app.stdin.write(ENTER)
    await app.until(() => app.frame().includes('smaller'))
    app.stdin.write(ENTER)
    await app.until(() => app.frame().includes('Save as'))
    app.stdin.write(ENTER)
    await settle(60)
    app.stdin.write(String.fromCharCode(27))
    await app.until(() => app.frame().includes('go home'), 30_000)
    const done = app.frame()
    expect(done).toContain('stopped')
    expect(done).not.toContain('Watching')
    const written = await readdir(out)
    expect(written.length).toBeGreaterThan(0)
    expect(written.length).toBeLessThan(8)
  }, 60_000)
})

describe('several files in convert mode', () => {
  it('converts them as one batch and lists each, from → to, without watching', async () => {
    const dir = await makeTempDir()
    const out = await makeTempDir()
    const paths = await photos(dir)
    const app = await compressHome(out)
    app.stdin.write('1')
    await settle(300)
    app.stdin.write(paths.join(' '))
    await app.until(() => app.frame().includes('3 images'))
    app.stdin.write(ENTER)
    await app.until(() => app.frame().includes('Convert to'))
    expect(app.frame()).toContain('JPEG ×3')
    app.stdin.write(ENTER)
    await app.until(() => app.frame().includes('smaller'))
    app.stdin.write(ENTER)
    await app.until(() => app.frame().includes('Save as'))
    app.stdin.write(ENTER)
    await app.until(() => app.frame().includes('go home'))
    expect(app.frame()).toMatch(/two\.jpg +JPEG → WebP/)
    expect(app.frame()).toMatch(/convert ╱.*╱ Done/)
    expect((await readdir(out)).sort()).toEqual(['one.webp', 'three.webp', 'two.webp'])
  }, 40_000)
})

describe('a folder in compress mode', () => {
  it('is its card on home, compresses what it holds, then watches it', async () => {
    const root = await makeTempDir()
    const folder = join(root, 'Trip')
    await mkdir(folder)
    await photos(folder)
    const app = await compressHome(folder)
    app.stdin.write(folder)
    await app.until(() => app.frame().includes('FOLDER – Trip'))
    app.stdin.write(ENTER)
    await app.until(() => app.frame().includes('Method'))
    app.stdin.write(ENTER)
    await app.until(() => app.frame().includes('smaller'))
    app.stdin.write(ENTER)
    await app.until(() => app.frame().includes('Save as'))
    app.stdin.write(ENTER)
    await app.until(() => app.frame().includes('Watching'))
    expect(app.frame()).toContain('Any new files you add will be compressed.')
    expect(app.frame()).toMatch(/two\.jpg +\d.* → /)
    expect(app.frame()).toContain('stop and go home')
    expect(existsSync(join(folder, 'two-small.jpg'))).toBe(true)
  }, 40_000)
})
