import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveOutputPath } from '../../src/core/output-path.js'
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
