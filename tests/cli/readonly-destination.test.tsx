import { chmod, mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import { afterEach, describe, expect, it } from 'vitest'
import { parseArgs } from '../../src/cli/args.js'
import { execute } from '../../src/cli/execute.js'
import { writeAtomic } from '../../src/core/atomic.js'
import { conversionFailed, isForgeError } from '../../src/core/errors.js'
import { HistoryEntry } from '../../src/shell/blocks.js'
import { makeJpeg, makePng, makeTempDir } from '../helpers/fixtures.js'

const run = (argv: string[]) => execute(parseArgs(argv))

/**
 * Root ignores mode bits, so the refusal under test never happens; Windows
 * has no POSIX mode bits for chmod to set.
 */
const asRoot = process.getuid?.() === 0 || process.platform === 'win32'

const locked: string[] = []
async function lockedDir(parent: string): Promise<string> {
  const dir = join(parent, 'locked')
  await mkdir(dir)
  await chmod(dir, 0o500)
  locked.push(dir)
  return dir
}

afterEach(async () => {
  // Restored so the temp tree can be cleaned up.
  for (const dir of locked.splice(0)) await chmod(dir, 0o700).catch(() => {})
})

/**
 * A destination the user cannot write to was reported as "Conversion failed
 * / Run again with --debug", which only `--debug` revealed to be "Permission
 * denied". Sharp's write error carries no errno code, and `mkdir -p` succeeds
 * on a directory that already exists, so nothing ever classified it. The
 * shell showed the same text — a flag it does not have.
 */
describe.skipIf(asRoot)('a read-only destination', () => {
  it('says permission denied when converting into it', async () => {
    const dir = await makeTempDir()
    const src = await makePng(dir, 'big.png')
    const out = await lockedDir(dir)

    const result = await run([src, '--to', 'jpeg', '-o', `${out}/`])

    expect(result.exitCode).toBe(1)
    const stderr = result.stderr.join('\n')
    expect(stderr).toContain('Permission denied')
    expect(stderr).not.toContain('Conversion failed')
    expect(stderr).not.toContain('--debug')
  })

  it('says permission denied when compressing into it', async () => {
    const dir = await makeTempDir()
    const src = await makeJpeg(dir, 'photo.jpg')
    const out = await lockedDir(dir)

    const result = await run([src, '--quality', '40', '-o', `${out}/`])

    expect(result.exitCode).toBe(1)
    expect(result.stderr.join('\n')).toContain('Permission denied')
  })

  it('names the folder, not the source, as what could not be written', async () => {
    const dir = await makeTempDir()
    const src = await makePng(dir, 'big.png')
    const out = await lockedDir(dir)

    const result = await run([src, '--to', 'jpeg', '-o', `${out}/`])

    expect(result.stderr.join('\n')).toContain('locked')
  })

  it('is classified for every engine that writes through core writeAtomic', async () => {
    const dir = await makeTempDir()
    const out = await lockedDir(dir)

    const error = await writeAtomic(join(out, 'doc.pdf'), new Uint8Array([1])).catch(
      (e: unknown) => e,
    )

    expect(isForgeError(error) && error.code).toBe('permission-denied')
    // Nothing half-written was left behind.
    expect(await readdir(out)).toEqual([])
  })

  it('is classified when the folder to be created sits inside it', async () => {
    const dir = await makeTempDir()
    const out = await lockedDir(dir)

    const error = await writeAtomic(join(out, 'sub', 'doc.pdf'), new Uint8Array([1])).catch(
      (e: unknown) => e,
    )

    expect(isForgeError(error) && error.code).toBe('permission-denied')
  })
})

describe('a generic conversion failure in the shell', () => {
  it('does not tell the shell user to run the shell again with --debug', () => {
    // The shell has no --debug. Pointing at the command line, which does, is
    // advice they can follow; "run again with --debug" here is not.
    const error = conversionFailed('/tmp/photo.png', new Error('boom'))
    const frame = (
      render(<HistoryEntry block={{ kind: 'error', id: 'e1', error }} width={80} />).lastFrame() ??
      ''
    ).replace(/[│\s]+/g, ' ')
    expect(frame).toContain('Conversion failed')
    expect(frame).not.toContain('Run again with --debug')
    expect(frame).toContain('command line')
  })
})
