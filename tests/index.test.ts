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
import { makeJpeg, makeTempDir } from './helpers/fixtures.js'

const run = promisify(execFile)
const tsx = join(process.cwd(), 'node_modules', '.bin', 'tsx')
const entry = join(process.cwd(), 'src', 'index.ts')

interface Spawned {
  exitCode: number
  stdout: string
  stderr: string
}

async function spawn(args: string[], cwd?: string): Promise<Spawned> {
  try {
    const { stdout, stderr } = await run(tsx, [entry, ...args], { cwd })
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

  it('exits 0 for --help and --version', async () => {
    expect((await spawn(['--help'])).exitCode).toBe(0)
    expect((await spawn(['--version'])).exitCode).toBe(0)
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
