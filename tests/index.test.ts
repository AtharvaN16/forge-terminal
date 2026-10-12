// tests/index.test.ts
//
// src/index.ts is the CLI entrypoint: it runs `await main()` at module top
// level, so it can only be exercised by actually invoking the process, not by
// importing it into a unit test. These tests spawn it through tsx, against
// source (not dist), so a fix here is verified before `npm run build` ever
// runs.
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { makeDocx, makeJpeg, makeTempDir, makeTextPdf } from './helpers/fixtures.js'
import { TSX_CLI } from './helpers/run-forge.js'

const run = promisify(execFile)
const entry = join(process.cwd(), 'src', 'index.ts')

interface Spawned {
  exitCode: number
  stdout: string
  stderr: string
}

async function spawn(args: string[], cwd?: string): Promise<Spawned> {
  try {
    const { stdout, stderr } = await run(process.execPath, [TSX_CLI, entry, ...args], { cwd })
    return { exitCode: 0, stdout, stderr }
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string }
    return { exitCode: err.code ?? -1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' }
  }
}

/** Runs some other script under tsx — used for the TTY-shaping child below. */
async function spawnScript(script: string): Promise<Spawned> {
  try {
    const { stdout, stderr } = await run(process.execPath, [TSX_CLI, script])
    return { exitCode: 0, stdout, stderr }
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string }
    return { exitCode: err.code ?? -1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' }
  }
}

describe('CLI exit codes', () => {
  it('exits 2 on an unknown option, distinct from the 1 that means "some files failed"', async () => {
    expect((await spawn(['--bogus'])).exitCode).toBe(2)
  })

  it('exits 2 when an option is missing its required argument', async () => {
    expect((await spawn(['a.jpg', '--to'])).exitCode).toBe(2)
  })

  it('names probe, config and mcp in --help', async () => {
    const result = await spawn(['--help'])
    expect(result.stdout).toContain('forge probe')
    expect(result.stdout).toContain('forge config')
    expect(result.stdout).toContain('forge mcp')
  })

  it('prints the exit-code contract in --help', async () => {
    const result = await spawn(['--help'])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Exit codes:')
    expect(result.stdout).toMatch(/2\s+the command itself was invalid/)
  })

  it('exits 0 for --help and --version', async () => {
    expect((await spawn(['--help'])).exitCode).toBe(0)
    expect((await spawn(['--version'])).exitCode).toBe(0)
  })
})

/**
 * `useInput` calls `setRawMode(true)` on stdin, which throws when stdin is
 * not a TTY. Gating the shell on `process.stdout.isTTY` alone let
 * `forge < /dev/null` — and every Makefile recipe and IDE run pane shaped
 * like it — reach Ink anyway, whose ErrorBoundary then rendered the raw
 * stack. The existing hint is the right output for that case.
 */
describe('shell launch gate', () => {
  const child = join(process.cwd(), 'tests', 'helpers', 'tty-gate-child.ts')

  it('prints the hint instead of the shell when stdout is a TTY but stdin is not', async () => {
    const result = await spawnScript(child)
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('Forge needs a file and a target format.')
    expect(`${result.stdout}${result.stderr}`).not.toContain('setRawMode')
  })
})

describe('CLI batch progress', () => {
  it('stays quiet on stderr when not a TTY, even for a multi-file batch', async () => {
    const dir = await makeTempDir()
    for (let i = 0; i < 3; i++) await makeJpeg(dir, `f${i}.jpg`)
    const result = await spawn([dir, '--to', 'webp'])
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
  })
})

/**
 * `docx` bundles a browser build of `util-deprecate`, which reads
 * `globalThis.localStorage` while the module evaluates. On Node 26 that
 * getter emits an ExperimentalWarning when `--localstorage-file` is absent,
 * so loading `docx` at all used to put a warning on stderr for every
 * invocation — `--version` included. Scripts that check stderr saw noise.
 */
describe('stderr hygiene', () => {
  it('prints nothing on stderr for --version', async () => {
    const result = await spawn(['--version'])
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
  })

  it('prints nothing on stderr for a conversion that writes a docx', async () => {
    const dir = await makeTempDir()
    const pdf = await makeTextPdf(dir, 'notes.pdf', ['Hello from Forge.'])
    const result = await spawn([pdf, '--to', 'docx'])
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
  })

  it('prints nothing on stderr for a conversion that reads a docx', async () => {
    const dir = await makeTempDir()
    const docx = await makeDocx(dir, 'notes.docx')
    const result = await spawn([docx, '--to', 'pdf'])
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
  })
})
