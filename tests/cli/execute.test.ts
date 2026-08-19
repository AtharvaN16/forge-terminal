import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseArgs } from '../../src/cli/args.js'
import { execute } from '../../src/cli/execute.js'
import { makeJpeg, makeTempDir } from '../helpers/fixtures.js'

describe('execute', () => {
  it('converts one file and exits 0', async () => {
    const dir = await makeTempDir()
    const a = await makeJpeg(dir, 'a.jpg')
    const out = await execute(parseArgs([a, '--to', 'webp']))
    expect(out.exitCode).toBe(0)
    expect(out.stdout.join('\n')).toContain('a.webp')
    expect(existsSync(join(dir, 'a.webp'))).toBe(true)
  })

  it('converts a folder and reports a batch', async () => {
    const dir = await makeTempDir()
    for (let i = 0; i < 3; i++) await makeJpeg(dir, `f${i}.jpg`)
    const out = await execute(parseArgs([dir, '--to', 'webp']))
    expect(out.exitCode).toBe(0)
    expect(out.stdout.join('\n')).toContain('3 converted')
  })

  it('exits 1 when a named file is missing, and says which', async () => {
    const dir = await makeTempDir()
    const out = await execute(parseArgs([join(dir, 'ghost.jpg'), '--to', 'webp']))
    expect(out.exitCode).toBe(1)
    expect(out.stderr.join('\n')).toContain('ghost.jpg')
  })

  it('exits 1 when some succeed and some fail', async () => {
    const dir = await makeTempDir()
    const a = await makeJpeg(dir, 'a.jpg')
    const out = await execute(parseArgs([a, join(dir, 'ghost.jpg'), '--to', 'webp']))
    expect(out.exitCode).toBe(1)
    expect(out.stdout.join('\n')).toContain('a.webp')
    expect(out.stderr.join('\n')).toContain('ghost.jpg')
  })

  it('refuses to overwrite, then allows it with force', async () => {
    const dir = await makeTempDir()
    const a = await makeJpeg(dir, 'a.jpg')
    expect((await execute(parseArgs([a, '--to', 'webp']))).exitCode).toBe(0)
    expect((await execute(parseArgs([a, '--to', 'webp']))).exitCode).toBe(1)
    expect((await execute(parseArgs([a, '--to', 'webp', '--force']))).exitCode).toBe(0)
  })

  it('prints the format table and exits 0', async () => {
    const out = await execute({ kind: 'formats' })
    expect(out.exitCode).toBe(0)
    expect(out.stdout.join('\n')).toContain('HEIC')
  })

  it('never leaks a stack trace without --debug', async () => {
    const dir = await makeTempDir()
    const out = await execute(parseArgs([join(dir, 'ghost.jpg'), '--to', 'webp']))
    expect(out.stderr.join('\n')).not.toContain('at ')
  })
})
