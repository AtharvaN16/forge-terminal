import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseArgs } from '../../src/cli/args.js'
import { execute } from '../../src/cli/execute.js'
import { targetIdsFor } from '../../src/core/capabilities.js'
import { isForgeError } from '../../src/core/errors.js'
import type { ProbeJson } from '../../src/core/report-data.js'
import { probe } from '../../src/engines/registry.js'
import { makeJpeg, makePdf, makeTempDir } from '../helpers/fixtures.js'
import { runForge } from '../helpers/run-forge.js'

function codeOf(argv: string[]): string {
  try {
    parseArgs(argv)
  } catch (e) {
    return isForgeError(e) ? e.code : `unexpected:${String(e)}`
  }
  return 'no-error'
}

describe('parsing forge probe', () => {
  it('takes one or more files', () => {
    expect(parseArgs(['probe', 'a.jpg', 'b.pdf'])).toEqual({
      kind: 'probe',
      inputs: ['a.jpg', 'b.pdf'],
    })
    expect(parseArgs(['probe', 'a.jpg', '--json'])).toEqual({ kind: 'probe', inputs: ['a.jpg'] })
  })

  it('refuses no files, and flags it does not take', () => {
    expect(codeOf(['probe'])).toBe('invalid-arguments')
    expect(codeOf(['probe', 'a.jpg', '--to', 'png'])).toBe('invalid-arguments')
  })
})

describe('forge probe', () => {
  it('answers --json with the §3.3 facts, from the capability graph', async () => {
    const dir = await makeTempDir()
    const pdf = await makePdf(dir, 'scan.pdf', 3)
    const out = await execute(parseArgs(['probe', pdf, '--json']), { json: true })
    expect(out.exitCode).toBe(0)
    expect(out.stdout).toHaveLength(1)
    const doc = JSON.parse(out.stdout[0] ?? '') as ProbeJson
    expect(doc.ok).toBe(true)
    expect(doc.probes[0]).toMatchObject({
      path: pdf,
      format: 'pdf',
      pages: 3,
      encrypted: false,
      targets: targetIdsFor(await probe(pdf)),
    })
  })

  it('prints the same facts as text', async () => {
    const dir = await makeTempDir()
    const pdf = await makePdf(dir, 'scan.pdf', 3)
    const out = await execute(parseArgs(['probe', pdf]))
    const text = out.stdout.join('\n')
    expect(text).toContain('PDF')
    expect(text).toContain('3 pages')
    expect(text).toContain('split')
    expect(text).toMatch(/converts to\s+.*png/)
  })

  it('exits 1 and reports a missing file, still describing the rest', async () => {
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'a.jpg')
    const out = await execute(parseArgs(['probe', jpg, join(dir, 'ghost.jpg'), '--json']), {
      json: true,
    })
    const doc = JSON.parse(out.stdout[0] ?? '') as ProbeJson
    expect(out.exitCode).toBe(1)
    expect(doc.probes).toHaveLength(1)
    expect(doc.failures[0]?.code).toBe('file-not-found')
  })

  it('writes nothing', async () => {
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'a.jpg')
    const before = await readdir(dir)
    await execute(parseArgs(['probe', jpg]))
    expect(await readdir(dir)).toEqual(before)
  })

  it('runs from the real entry point with stdin closed', async () => {
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'a.jpg')
    const run = await runForge(['probe', jpg, '--json'])
    expect(run.exitCode).toBe(0)
    expect((JSON.parse(run.stdout) as ProbeJson).probes[0]?.format).toBe('jpeg')
  })
})
