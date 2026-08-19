import { mkdir, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveInputs } from '../../src/core/resolve.js'
import { makeCorruptFile, makeJpeg, makePng, makeTempDir } from '../helpers/fixtures.js'

const names = (paths: { path: string }[]) => paths.map((s) => basename(s.path)).sort()

describe('resolveInputs', () => {
  it('resolves a single explicit file', async () => {
    const dir = await makeTempDir()
    const a = await makeJpeg(dir, 'a.jpg')
    const { sources } = await resolveInputs([a], { recursive: false })
    expect(names(sources)).toEqual(['a.jpg'])
  })

  it('resolves several explicit files', async () => {
    const dir = await makeTempDir()
    await makeJpeg(dir, 'a.jpg')
    await makePng(dir, 'b.png')
    const { sources } = await resolveInputs([join(dir, 'a.jpg'), join(dir, 'b.png')], {
      recursive: false,
    })
    expect(names(sources)).toEqual(['a.jpg', 'b.png'])
  })

  it('expands a quoted glob itself', async () => {
    const dir = await makeTempDir()
    await makeJpeg(dir, 'a.jpg')
    await makeJpeg(dir, 'b.jpg')
    await makePng(dir, 'c.png')
    const { sources } = await resolveInputs([join(dir, '*.jpg')], { recursive: false })
    expect(names(sources)).toEqual(['a.jpg', 'b.jpg'])
  })

  it('scans a directory one level deep by default', async () => {
    const dir = await makeTempDir()
    await makeJpeg(dir, 'top.jpg')
    await mkdir(join(dir, 'sub'))
    await makeJpeg(join(dir, 'sub'), 'deep.jpg')
    const { sources } = await resolveInputs([dir], { recursive: false })
    expect(names(sources)).toEqual(['top.jpg'])
  })

  it('descends when recursive', async () => {
    const dir = await makeTempDir()
    await makeJpeg(dir, 'top.jpg')
    await mkdir(join(dir, 'sub'))
    await makeJpeg(join(dir, 'sub'), 'deep.jpg')
    const { sources } = await resolveInputs([dir], { recursive: true })
    expect(names(sources)).toEqual(['deep.jpg', 'top.jpg'])
  })

  it('records the scan root of a directory so the tree can be recreated', async () => {
    const dir = await makeTempDir()
    const a = await makeJpeg(dir, 'a.jpg')
    const { roots } = await resolveInputs([dir], { recursive: true })
    expect(roots.get(a)).toBe(dir)
  })

  it('skips non-images inside a directory without complaining', async () => {
    const dir = await makeTempDir()
    await makeJpeg(dir, 'a.jpg')
    await writeFile(join(dir, 'notes.txt'), 'hello')
    const { sources, failures } = await resolveInputs([dir], { recursive: false })
    expect(names(sources)).toEqual(['a.jpg'])
    expect(failures).toEqual([])
  })

  it('reports an explicitly named bad file as a failure and keeps going', async () => {
    const dir = await makeTempDir()
    const good = await makeJpeg(dir, 'good.jpg')
    const bad = await makeCorruptFile(dir, 'bad.jpg')
    const { sources, failures } = await resolveInputs([good, bad], { recursive: false })
    expect(names(sources)).toEqual(['good.jpg'])
    expect(failures).toHaveLength(1)
    expect(failures[0]?.error.code).toBe('corrupt-source')
  })

  it('raises empty-directory when a folder holds nothing convertible', async () => {
    const dir = await makeTempDir()
    await writeFile(join(dir, 'notes.txt'), 'hello')
    const { failures } = await resolveInputs([dir], { recursive: false })
    expect(failures[0]?.error.code).toBe('empty-directory')
  })

  it('deduplicates a file named twice', async () => {
    const dir = await makeTempDir()
    const a = await makeJpeg(dir, 'a.jpg')
    const { sources } = await resolveInputs([a, a], { recursive: false })
    expect(sources).toHaveLength(1)
  })
})
