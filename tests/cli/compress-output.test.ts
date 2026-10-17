import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseArgs } from '../../src/cli/args.js'
import { execute } from '../../src/cli/execute.js'
import { makeNoiseImage, makeTempDir } from '../helpers/fixtures.js'

const run = (argv: string[]) => execute(parseArgs(argv))

/**
 * `-o` used to be parsed and dropped on the compress path — `CompressIntent`
 * had nowhere to put it — so the file landed beside the source while the
 * output-exists refusal told the user to "choose a different --output". It is
 * honoured now, with the same file-or-directory reading a conversion gives it.
 */
describe('compress honours --output', () => {
  it('writes into the directory --output names, not beside the source', async () => {
    const dir = await makeTempDir()
    const src = await makeNoiseImage(dir, 'noisy.jpg', 64, 'jpeg')
    const elsewhere = join(dir, 'elsewhere')
    await mkdir(elsewhere)

    const result = await run([src, '--quality', '40', '-o', `${elsewhere}/`])

    expect(result.exitCode).toBe(0)
    expect(existsSync(join(elsewhere, 'noisy-small.jpg'))).toBe(true)
    expect(existsSync(join(dir, 'noisy-small.jpg'))).toBe(false)
  })

  it('creates a directory --output names that does not exist yet', async () => {
    const dir = await makeTempDir()
    const src = await makeNoiseImage(dir, 'noisy.jpg', 64, 'jpeg')

    const result = await run([src, '--quality', '40', '-o', join(dir, 'out')])

    expect(result.exitCode).toBe(0)
    expect(existsSync(join(dir, 'out', 'noisy-small.jpg'))).toBe(true)
  })

  it('writes to the exact file --output names', async () => {
    const dir = await makeTempDir()
    const src = await makeNoiseImage(dir, 'noisy.jpg', 64, 'jpeg')
    const target = join(dir, 'tiny.jpg')

    const result = await run([src, '--quality', '40', '-o', target])

    expect(result.exitCode).toBe(0)
    expect(existsSync(target)).toBe(true)
    expect(existsSync(join(dir, 'noisy-small.jpg'))).toBe(false)
  })

  it('makes the output-exists advice true: a different --output gets past it', async () => {
    const dir = await makeTempDir()
    const src = await makeNoiseImage(dir, 'noisy.jpg', 64, 'jpeg')

    expect((await run([src, '--quality', '40'])).exitCode).toBe(0)
    const refused = await run([src, '--quality', '40'])
    expect(refused.exitCode).toBe(1)
    expect(refused.stderr.join('\n')).toContain('--output')

    const moved = await run([src, '--quality', '40', '-o', join(dir, 'again')])
    expect(moved.exitCode).toBe(0)
    expect(existsSync(join(dir, 'again', 'noisy-small.jpg'))).toBe(true)
  })

  it('carries --output on the parsed intent', () => {
    const intent = parseArgs(['photo.jpg', '--max-size', '500kb', '-o', 'out/'])
    if (intent.kind !== 'compress') throw new Error('expected compress')
    expect(intent.output).toBe('out/')
  })
})
