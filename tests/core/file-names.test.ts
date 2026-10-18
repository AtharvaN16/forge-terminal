import { readdir, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { tempBeside, writeAtomic } from '../../src/core/atomic.js'
import {
  fitName,
  resolveOutputPath,
  splitOutputPaths,
  suffixedImagePath,
  suffixedOutputPath,
  uniqueOutputPath,
} from '../../src/core/output-path.js'
import { safeStem } from '../../src/shell/destinations.js'
import { makeTempDir } from '../helpers/fixtures.js'

// The longest name a folder takes is 255: UTF-16 units on a Mac and Windows,
// bytes on Linux. A source near it must still get an output it can write.
describe('fitName', () => {
  it('leaves a name that fits alone', () => {
    expect(fitName('photo', '-small.png', 'darwin')).toBe('photo-small.png')
  })

  it('cuts the stem, never the tail, to 255', () => {
    const name = fitName('x'.repeat(300), '-compressed.png', 'darwin')
    expect(name).toHaveLength(255)
    expect(name.endsWith('x-compressed.png')).toBe(true)
  })

  it('never splits an emoji, which is two UTF-16 units', () => {
    const name = fitName('🎬'.repeat(200), '.png', 'darwin')
    expect(name.length).toBeLessThanOrEqual(255)
    expect(name).toBe(`${'🎬'.repeat(125)}.png`)
  })

  it('counts bytes on Linux', () => {
    const name = fitName('é'.repeat(200), '.png', 'linux')
    expect(Buffer.byteLength(name)).toBeLessThanOrEqual(255)
    expect(name).toBe(`${'é'.repeat(125)}.png`)
  })
})

describe('output names for a source whose name is as long as a name can be', () => {
  const long = (dir: string) => join(dir, `${'x'.repeat(251)}.png`)

  it('every way of naming an output stays writable', async () => {
    const dir = await makeTempDir()
    const source = long(dir)
    await writeFile(source, 'x')
    const outputs = [
      resolveOutputPath({ sourcePath: source, target: 'webp' }),
      suffixedImagePath({ sourcePath: source, target: 'png', suffix: 'cutout' }),
      suffixedOutputPath(source, 'compressed'),
      uniqueOutputPath(source),
      ...splitOutputPaths(source, 12),
    ]
    for (const o of outputs) {
      expect(basename(o).length).toBeLessThanOrEqual(255)
      await writeFile(o, 'x')
    }
  })

  it('writes atomically through a temp name that fits too', async () => {
    const dir = await makeTempDir()
    const output = long(dir)
    expect(basename(tempBeside(output)).length).toBeLessThanOrEqual(255)
    await writeAtomic(output, new Uint8Array([1, 2, 3]))
    expect(await readdir(dir)).toEqual([basename(output)])
  })

  it('keeps the temp name hidden and ending in the real extension', () => {
    const temp = basename(tempBeside('/a/photo.webp', 'abc'))
    expect(temp).toBe('.forge-abc-photo.webp')
  })
})

describe('safeStem: a typed Save as name', () => {
  it('drops the extension when it is typed, or a sibling of it', () => {
    expect(safeStem('holiday.jpg', 'darwin', '.jpg')).toBe('holiday')
    expect(safeStem('holiday.JPEG', 'darwin', '.jpg')).toBe('holiday')
    expect(safeStem('holiday.png', 'darwin', '.jpg')).toBe('holiday.png')
    expect(safeStem('.jpg', 'darwin', '.jpg')).toBe('.jpg')
  })

  it('is empty, so the proposal is used, for . and ..', () => {
    expect(safeStem('.', 'darwin', '.jpg')).toBe('')
    expect(safeStem('..', 'darwin', '.jpg')).toBe('')
  })

  it('drops control characters a paste can carry', () => {
    expect(safeStem('a\nb\u001b[31mc', 'darwin', '.jpg')).toBe('ab[31mc')
  })

  it('cuts a name too long for the folder, leaving room for the extension', () => {
    expect(safeStem('x'.repeat(300), 'darwin', '.jpg')).toBe('x'.repeat(251))
  })

  it('on Windows, drops trailing dots and spaces and steps round device names', () => {
    expect(safeStem('notes. . ', 'win32', '.png')).toBe('notes')
    expect(safeStem('con', 'win32', '.png')).toBe('con-')
    expect(safeStem('LPT1', 'win32', '.png')).toBe('LPT1-')
    expect(safeStem('console', 'win32', '.png')).toBe('console')
  })
})
