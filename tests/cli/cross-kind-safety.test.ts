import { existsSync } from 'node:fs'
import { mkdir, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseArgs } from '../../src/cli/args.js'
import { execute } from '../../src/cli/execute.js'
import { makePdf, makePng, makeTempDir } from '../helpers/fixtures.js'

/**
 * A document source and an image source take two different planning paths
 * inside `execute()` — `convertAction.plan()` for the first, `buildPlan()`
 * for the second. Write safety has to be decided across both sets at once or
 * the one rule that cannot be waived (`output-collision`) is simply never
 * reached when the two sides of the collision come from different kinds.
 */
describe('write safety across document and image sources', () => {
  it('refuses when a rasterised page and an image would write the same file', async () => {
    const dir = await makeTempDir()
    await makePdf(dir, 'doc.pdf', 1)
    await makePng(dir, 'doc-1.png')

    const out = await execute(
      parseArgs([join(dir, 'doc.pdf'), join(dir, 'doc-1.png'), '--to', 'jpeg']),
    )

    expect(out.exitCode).toBe(1)
    expect(out.stderr.join('\n')).toContain('Two files want the same output')
  })

  it('refuses the collision even with --force', async () => {
    const dir = await makeTempDir()
    await makePdf(dir, 'doc.pdf', 1)
    await makePng(dir, 'doc-1.png')

    const out = await execute(
      parseArgs([join(dir, 'doc.pdf'), join(dir, 'doc-1.png'), '--to', 'jpeg', '--force']),
    )

    expect(out.exitCode).toBe(1)
    expect(out.stderr.join('\n')).toContain('Two files want the same output')
  })

  it('still converts a document and an image whose outputs differ', async () => {
    const dir = await makeTempDir()
    await makePdf(dir, 'doc.pdf', 1)
    await makePng(dir, 'photo.png')

    const out = await execute(
      parseArgs([join(dir, 'doc.pdf'), join(dir, 'photo.png'), '--to', 'jpeg']),
    )

    expect(out.stderr).toEqual([])
    expect(out.exitCode).toBe(0)
    expect(existsSync(join(dir, 'doc-1.jpg'))).toBe(true)
    expect(existsSync(join(dir, 'photo.jpg'))).toBe(true)
  })
})

/**
 * `--recursive -o <dir>` recreates the source tree below the root it was
 * given. A document source has to land in the same place an image beside it
 * lands, or the same two flags mean two different things depending on what
 * was dropped on them.
 */
describe('--recursive --output for a document source', () => {
  it('recreates the source tree for a rasterised PDF, as it does for an image', async () => {
    const root = await makeTempDir()
    const input = join(root, 'in')
    const sub = join(input, 'sub')
    await mkdir(sub, { recursive: true })
    await makePdf(sub, 'a.pdf', 1)
    await makePng(sub, 'b.png')
    const output = join(root, 'out')

    const out = await execute(parseArgs([input, '--recursive', '-o', output, '--to', 'jpeg']))

    expect(out.stderr).toEqual([])
    expect(out.exitCode).toBe(0)

    const written: string[] = []
    for (const entry of await readdir(output, { recursive: true, withFileTypes: true })) {
      if (entry.isFile()) written.push(relative(output, join(entry.parentPath, entry.name)))
    }
    expect(written.sort()).toEqual([join('sub', 'a-1.jpg'), join('sub', 'b.jpg')])
  })
})
