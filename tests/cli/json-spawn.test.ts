import { cp, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { RunJson } from '../../src/core/report-data.js'
import { makeJpeg, makeTempDir } from '../helpers/fixtures.js'
import { runForge } from '../helpers/run-forge.js'

const LOCKED = fileURLToPath(new URL('../fixtures/locked-hunter2.pdf', import.meta.url))

/** stdout must be exactly one JSON document on one line, and nothing else. */
function onlyDocument(stdout: string): RunJson {
  expect(stdout.endsWith('\n')).toBe(true)
  expect(stdout.trimEnd().split('\n')).toHaveLength(1)
  return JSON.parse(stdout) as RunJson
}

describe('--json from the real entry point', () => {
  it('prints one document for a conversion and nothing on stderr', async () => {
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'a.jpg')
    const run = await runForge([jpg, '--to', 'webp', '--json'])
    expect(run.exitCode).toBe(0)
    expect(onlyDocument(run.stdout).ok).toBe(true)
    expect(run.stderr).toBe('')
  })

  it('reports an unknown flag as invalid-arguments JSON with exit 2', async () => {
    const run = await runForge(['a.jpg', '--bogus', '--json'])
    expect(run.exitCode).toBe(2)
    expect(onlyDocument(run.stdout).failures[0]?.code).toBe('invalid-arguments')
    expect(run.stderr).toBe('')
  })

  it('reports a bare --json (which would open the shell) as invalid-arguments', async () => {
    const run = await runForge(['--json'])
    expect(run.exitCode).toBe(2)
    expect(onlyDocument(run.stdout).failures[0]?.code).toBe('invalid-arguments')
  })

  it('reports an encrypted PDF on an open pipe as JSON, without hanging', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'forge-json-'))
    const pdf = join(dir, 'locked.pdf')
    await cp(LOCKED, pdf)
    const run = await runForge([pdf, '--to', 'jpeg', '--json'], { stdin: { kind: 'open' } })
    expect(run.timedOut).toBe(false)
    expect(run.exitCode).toBe(1)
    expect(onlyDocument(run.stdout).failures[0]?.code).toBe('encrypted-source')
  })
})
