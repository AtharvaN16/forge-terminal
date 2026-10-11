import { existsSync } from 'node:fs'
import { cp, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseArgs } from '../../src/cli/args.js'
import { execute } from '../../src/cli/execute.js'
import { makePdf } from '../helpers/fixtures.js'

const FIXTURE = fileURLToPath(new URL('../fixtures/locked-hunter2.pdf', import.meta.url))
const RIGHT_PASSWORD = 'hunter2'
const WRONG_PASSWORD = 'not-the-password'

/**
 * A private copy per test, not the checked-in fixture path directly:
 * execute() writes its outputs beside the source, and every test in this
 * file runs against the same fixture file.
 */
async function lockedPdfCopy(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'forge-locked-'))
  const path = join(dir, 'locked.pdf')
  await cp(FIXTURE, path)
  return path
}

function stdinOf(text: string): NodeJS.ReadableStream {
  return Readable.from([text])
}

describe('rasterising an encrypted PDF from the CLI', () => {
  let originalStdin: NodeJS.ReadableStream

  beforeEach(() => {
    originalStdin = process.stdin
  })

  afterEach(() => {
    Object.defineProperty(process, 'stdin', { value: originalStdin, configurable: true })
  })

  it('rasterises every page once the right password is supplied via stdin', async () => {
    const path = await lockedPdfCopy()
    Object.defineProperty(process, 'stdin', {
      value: stdinOf(`${RIGHT_PASSWORD}\n`),
      configurable: true,
    })

    const intent = parseArgs([path, '--to', 'jpeg', '--password-stdin'])
    const out = await execute(intent)

    expect(out.exitCode).toBe(0)
    expect(existsSync(join(path, '..', 'locked-1.jpg'))).toBe(true)
    expect(existsSync(join(path, '..', 'locked-2.jpg'))).toBe(true)
    expect(existsSync(join(path, '..', 'locked-3.jpg'))).toBe(true)
  })

  it('refuses a wrong password without leaking it anywhere in the output', async () => {
    const path = await lockedPdfCopy()
    Object.defineProperty(process, 'stdin', {
      value: stdinOf(`${WRONG_PASSWORD}\n`),
      configurable: true,
    })

    const intent = parseArgs([path, '--to', 'jpeg', '--password-stdin', '--debug'])
    const out = await execute(intent)

    expect(out.exitCode).toBe(1)
    const text = [...out.stdout, ...out.stderr].join('\n')
    expect(text).toContain('password-protected')
    // Invariant 8: not in a Result, not in an error's detail/hint, not in
    // --debug's cause output — nowhere the attempted password could surface.
    expect(text).not.toContain(WRONG_PASSWORD)
    expect(existsSync(join(path, '..', 'locked-1.jpg'))).toBe(false)
  })

  it('never prompts for an unencrypted source', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'forge-plain-'))
    const path = await makePdf(dir, 'plain.pdf', 2)
    // A stream that throws if anything ever reads from it — proof that
    // readPassword() was never called for a file that is not encrypted.
    const explosive = new Readable({
      read() {
        this.destroy(new Error('stdin was read for an unencrypted source'))
      },
    })
    Object.defineProperty(process, 'stdin', { value: explosive, configurable: true })

    const intent = parseArgs([path, '--to', 'jpeg'])
    const out = await execute(intent)

    expect(out.exitCode).toBe(0)
    expect(existsSync(join(dir, 'plain-1.jpg'))).toBe(true)
    expect(existsSync(join(dir, 'plain-2.jpg'))).toBe(true)
  })
  it('reads the password once and uses it for every encrypted source', async () => {
    const first = await lockedPdfCopy()
    const dir = join(first, '..')
    const second = join(dir, 'other.pdf')
    await cp(FIXTURE, second)
    Object.defineProperty(process, 'stdin', {
      value: stdinOf(`${RIGHT_PASSWORD}\n`),
      configurable: true,
    })

    const out = await execute(parseArgs([first, second, '--to', 'png', '--password-stdin']))

    expect(out.exitCode).toBe(0)
    for (const name of ['locked', 'other']) {
      for (const n of [1, 2, 3]) expect(existsSync(join(dir, `${name}-${n}.png`))).toBe(true)
    }
  }, 15000)

  it('treats an empty stdin as no password, not a wrong one', async () => {
    const path = await lockedPdfCopy()
    Object.defineProperty(process, 'stdin', { value: stdinOf(''), configurable: true })

    const out = await execute(parseArgs([path, '--to', 'png', '--password-stdin', '--json']), {
      json: true,
    })

    expect(out.exitCode).toBe(1)
    const doc = JSON.parse(out.stdout.join('\n'))
    const text = JSON.stringify(doc)
    expect(text).toContain('encrypted-source')
    expect(text).toContain('--password-stdin')
    expect(text).not.toContain("didn't open it")
  })
})
