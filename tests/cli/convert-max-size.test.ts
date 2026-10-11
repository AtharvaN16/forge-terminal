import { existsSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseArgs } from '../../src/cli/args.js'
import { execute } from '../../src/cli/execute.js'
import { makeNoisyOrientedJpeg, makeTempDir, makeTextPdf } from '../helpers/fixtures.js'

/**
 * Spec §4.6. `--to jpeg --max-size 50kb` used to produce a 75.5 KB file with
 * no warning: the size was parsed and then dropped. A size given with --to
 * now applies to that target, through the same search compression uses.
 */
async function defaultSize(source: string, target: string, dir: string): Promise<number> {
  const out = join(dir, `default.${target}`)
  const result = await execute(parseArgs([source, '--to', target, '-o', out]))
  expect(result.exitCode).toBe(0)
  return (await stat(out)).size
}

describe('--to <format> --max-size', () => {
  it.each(['jpeg', 'webp'])('fits a %s conversion under the size it was given', async (target) => {
    const dir = await makeTempDir()
    const source = await makeNoisyOrientedJpeg(dir, 'photo.jpg')
    const limit = Math.floor((await defaultSize(source, target, dir)) * 0.6)

    const out = join(dir, `fitted.${target}`)
    const result = await execute(
      parseArgs([source, '--to', target, '--max-size', `${limit}b`, '-o', out]),
    )

    expect(result.exitCode).toBe(0)
    expect((await stat(out)).size).toBeLessThanOrEqual(limit)
  })

  it('refuses a lossless target instead of ignoring the size, and writes nothing', async () => {
    const dir = await makeTempDir()
    const source = await makeNoisyOrientedJpeg(dir, 'photo.jpg')
    const out = join(dir, 'photo.png')
    const result = await execute(
      parseArgs([source, '--to', 'png', '--max-size', '10kb', '-o', out]),
    )

    expect(result.exitCode).toBe(1)
    expect(result.stderr.join('\n')).toContain('PNG is lossless')
    expect(existsSync(out)).toBe(false)
  })

  it('reports a size no quality can reach, and writes nothing', async () => {
    const dir = await makeTempDir()
    const source = await makeNoisyOrientedJpeg(dir, 'photo.jpg')
    const out = join(dir, 'tiny.jpg')
    const result = await execute(
      parseArgs([source, '--to', 'jpeg', '--max-size', '100b', '-o', out]),
    )

    expect(result.exitCode).toBe(1)
    expect(result.stderr.join('\n')).toContain('Cannot get that small')
    expect(existsSync(out)).toBe(false)
  })

  // Review Focus 5.
  it('in a mixed batch, fits what it can and refuses what it cannot, naming the target', async () => {
    const dir = await makeTempDir()
    const photo = await makeNoisyOrientedJpeg(dir, 'photo.jpg')
    await makeTextPdf(dir, 'notes.pdf', ['A page of text.'])
    const limit = Math.floor((await defaultSize(photo, 'jpeg', await makeTempDir())) * 0.6)
    const outDir = join(dir, 'out')

    const result = await execute(
      parseArgs([dir, '--to', 'jpeg', '--max-size', `${limit}b`, '-o', `${outDir}/`]),
    )

    expect(result.exitCode).toBe(1)
    const written = await readdir(outDir)
    expect(written).toEqual(['photo.jpg'])
    expect((await stat(join(outDir, 'photo.jpg'))).size).toBeLessThanOrEqual(limit)
    const stderr = result.stderr.join('\n')
    expect(stderr).toContain('notes.pdf')
    expect(stderr).toContain('JPEG')
  })
})
