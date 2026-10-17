import { appendFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { type FolderWatch, watchFolder } from '../../src/core/watch.js'
import { makeTempDir } from '../helpers/fixtures.js'

const FAST = { settleMs: 120, pollMs: 25 }
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Resolves once `seen` holds `n` paths, or fails after `ms`. */
async function until(seen: string[], n: number, ms = 3000): Promise<void> {
  const end = Date.now() + ms
  while (seen.length < n) {
    if (Date.now() > end) throw new Error(`saw ${seen.length} of ${n}: ${seen.join(', ')}`)
    await wait(10)
  }
}

let open: FolderWatch | undefined
afterEach(() => {
  open?.close()
  open = undefined
})

describe('watchFolder', () => {
  it('hands over a new file once it has stopped changing', async () => {
    const dir = await makeTempDir()
    const seen: string[] = []
    open = watchFolder(dir, [], { ...FAST, onFile: (p) => seen.push(p) })
    await wait(50)
    await writeFile(join(dir, 'a.png'), 'x')
    await wait(60)
    expect(seen).toEqual([])
    await until(seen, 1)
    expect(seen).toEqual([join(dir, 'a.png')])
  })

  it('leaves alone what was there when it started', async () => {
    const dir = await makeTempDir()
    await writeFile(join(dir, 'old.png'), 'x')
    const seen: string[] = []
    open = watchFolder(dir, [join(dir, 'old.png')], { ...FAST, onFile: (p) => seen.push(p) })
    await writeFile(join(dir, 'new.png'), 'y')
    await until(seen, 1)
    await wait(200)
    expect(seen).toEqual([join(dir, 'new.png')])
  })

  it('waits while a file is still being written', async () => {
    const dir = await makeTempDir()
    const seen: string[] = []
    open = watchFolder(dir, [], { ...FAST, onFile: (p) => seen.push(p) })
    const path = join(dir, 'growing.png')
    await writeFile(path, 'a')
    for (let i = 0; i < 6; i++) {
      await wait(50)
      await appendFile(path, 'more')
      expect(seen).toEqual([])
    }
    await until(seen, 1)
    expect(seen).toEqual([path])
  })

  it('never hands over hidden files, unfinished downloads or what it is told to ignore', async () => {
    const dir = await makeTempDir()
    const seen: string[] = []
    const mine = join(dir, 'hero.webp')
    open = watchFolder(dir, [], {
      ...FAST,
      ignore: (p) => p === mine,
      onFile: (p) => seen.push(p),
    })
    await writeFile(join(dir, '.forge-tmp-abc-hero.webp'), 'x')
    await writeFile(join(dir, 'b.png.crdownload'), 'x')
    await writeFile(mine, 'x')
    await writeFile(join(dir, 'last.png'), 'x')
    await until(seen, 1)
    await wait(200)
    expect(seen).toEqual([join(dir, 'last.png')])
  })

  it('hands over a file again once it has gone and come back', async () => {
    const dir = await makeTempDir()
    const seen: string[] = []
    const path = join(dir, 'a.png')
    open = watchFolder(dir, [], { ...FAST, onFile: (p) => seen.push(p) })
    await writeFile(path, 'x')
    await until(seen, 1)
    await rm(path)
    await wait(100)
    await writeFile(path, 'again')
    await until(seen, 2)
    expect(seen).toEqual([path, path])
  })

  it('says nothing once closed', async () => {
    const dir = await makeTempDir()
    const seen: string[] = []
    const watch = watchFolder(dir, [], { ...FAST, onFile: (p) => seen.push(p) })
    watch.close()
    await writeFile(join(dir, 'a.png'), 'x')
    await wait(400)
    expect(seen).toEqual([])
  })
})
