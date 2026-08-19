import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveOutputPath, uniqueOutputPath } from '../../src/core/output-path.js'
import { makeTempDir } from '../helpers/fixtures.js'

describe('resolveOutputPath', () => {
  it('defaults to the source folder with a swapped extension', () => {
    expect(resolveOutputPath({ sourcePath: '/a/b/photo.jpg', target: 'webp' })).toBe(
      resolve('/a/b/photo.webp'),
    )
  })

  it('uses .jpg rather than .jpeg for the jpeg target', () => {
    expect(resolveOutputPath({ sourcePath: '/a/photo.png', target: 'jpeg' })).toBe(
      resolve('/a/photo.jpg'),
    )
  })

  it('treats a trailing slash as a directory', () => {
    expect(resolveOutputPath({ sourcePath: '/a/photo.jpg', target: 'webp', output: '/out/' })).toBe(
      resolve('/out/photo.webp'),
    )
  })

  it('treats an existing directory as a directory even without a trailing slash', async () => {
    const dir = await makeTempDir()
    expect(resolveOutputPath({ sourcePath: '/a/photo.jpg', target: 'webp', output: dir })).toBe(
      join(dir, 'photo.webp'),
    )
  })

  it('treats a path with an extension as an explicit filename', () => {
    expect(
      resolveOutputPath({ sourcePath: '/a/photo.jpg', target: 'webp', output: '/out/x.webp' }),
    ).toBe(resolve('/out/x.webp'))
  })

  it('honours an explicit filename whose extension disagrees with the target', () => {
    expect(
      resolveOutputPath({ sourcePath: '/a/photo.jpg', target: 'webp', output: '/out/x.bin' }),
    ).toBe(resolve('/out/x.bin'))
  })

  it('recreates the source tree under the output directory when a root is given', () => {
    expect(
      resolveOutputPath({
        sourcePath: '/src/deep/nested/photo.jpg',
        target: 'webp',
        output: '/out/',
        sourceRoot: '/src',
      }),
    ).toBe(resolve('/out/deep/nested/photo.webp'))
  })

  it('flattens into the output directory when no root is given', () => {
    expect(
      resolveOutputPath({
        sourcePath: '/src/deep/nested/photo.jpg',
        target: 'webp',
        output: '/out/',
      }),
    ).toBe(resolve('/out/photo.webp'))
  })

  it('keeps a filename that contains dots', () => {
    expect(resolveOutputPath({ sourcePath: '/a/my.holiday.photo.jpg', target: 'png' })).toBe(
      resolve('/a/my.holiday.photo.png'),
    )
  })
})

/** The name behind spec §8's "keep both" choice in the shell. */
describe('uniqueOutputPath', () => {
  it('leaves a free name alone', async () => {
    const dir = await makeTempDir()
    const free = join(dir, 'photo.webp')
    expect(uniqueOutputPath(free)).toBe(free)
  })

  it('suffixes before the extension, so the file still opens in the right app', async () => {
    const dir = await makeTempDir()
    await writeFile(join(dir, 'photo.webp'), 'x')
    expect(uniqueOutputPath(join(dir, 'photo.webp'))).toBe(join(dir, 'photo (1).webp'))
  })

  it('counts up rather than overwriting the copy kept last time', async () => {
    const dir = await makeTempDir()
    await writeFile(join(dir, 'photo.webp'), 'x')
    await writeFile(join(dir, 'photo (1).webp'), 'x')
    await writeFile(join(dir, 'photo (2).webp'), 'x')
    expect(uniqueOutputPath(join(dir, 'photo.webp'))).toBe(join(dir, 'photo (3).webp'))
  })

  it('handles a name with no extension', async () => {
    const dir = await makeTempDir()
    await writeFile(join(dir, 'photo'), 'x')
    expect(uniqueOutputPath(join(dir, 'photo'))).toBe(join(dir, 'photo (1)'))
  })

  it('keeps every dot of a multi-dot name', async () => {
    const dir = await makeTempDir()
    await writeFile(join(dir, 'my.holiday.photo.webp'), 'x')
    expect(uniqueOutputPath(join(dir, 'my.holiday.photo.webp'))).toBe(
      join(dir, 'my.holiday.photo (1).webp'),
    )
  })
})
