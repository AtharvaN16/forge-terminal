import { stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fileNotFound, invalidArguments } from '../../src/core/errors.js'
import { buildPlan } from '../../src/core/plan.js'
import { errorJson, failureJson, resultJson, runJson } from '../../src/core/report-data.js'
import { resolveInputs } from '../../src/core/resolve.js'
import { runJobs } from '../../src/core/run.js'
import type { ConvertOptions, Job } from '../../src/core/types.js'
import { probe } from '../../src/engines/registry.js'
import { makeJpeg, makeMarkedPdf, makePdf, makeTempDir } from '../helpers/fixtures.js'

const options: ConvertOptions = { background: '#ffffff', keepMetadata: false }

async function convertOne(dir: string) {
  const src = await makeJpeg(dir, 'a.jpg')
  const resolved = await resolveInputs([src], { recursive: false })
  const plan = await buildPlan({ resolved, target: 'webp', options, force: false })
  const summary = await runJobs(plan.jobs, {})
  const result = summary.results[0]
  if (!result) throw new Error('expected one result')
  return { src, result }
}

describe('resultJson', () => {
  it('gives the source and every output as absolute paths, with exact byte counts', async () => {
    const dir = await makeTempDir()
    const { src, result } = await convertOne(dir)
    expect(resultJson(result)).toEqual({
      op: 'convert',
      source: src,
      sources: [src],
      outputs: [join(dir, 'a.webp')],
      inputBytes: (await stat(src)).size,
      outputBytes: result.outputBytes,
      warnings: [],
    })
  })

  it('lists every page of a rasterised PDF, not just the first', async () => {
    const dir = await makeTempDir()
    const src = await makeMarkedPdf(dir, 'doc.pdf', [1, 2, 3])
    const info = await probe(src)
    if (info.kind !== 'document') throw new Error('expected a document')
    const job: Job = {
      op: 'convert',
      sources: [info],
      outputs: [join(dir, 'doc-1.png'), join(dir, 'doc-2.png'), join(dir, 'doc-3.png')],
      target: 'png',
      options: { ...options, dpi: 72, pages: [0, 1, 2] },
    }
    const [result] = (await runJobs([job], {})).results
    if (!result) throw new Error('expected one result')
    expect(resultJson(result).outputs).toEqual(job.outputs)
  })

  it('names every source of a merge, the first as `source`', async () => {
    const dir = await makeTempDir()
    const a = await probe(await makePdf(dir, 'a.pdf', 1))
    const b = await probe(await makePdf(dir, 'b.pdf', 1))
    const job: Job = { op: 'merge', sources: [a, b], outputs: [join(dir, 'merged.pdf')] }
    const [result] = (await runJobs([job], {})).results
    if (!result) throw new Error('expected one result')
    const json = resultJson(result)
    expect(json.op).toBe('merge')
    expect(json.source).toBe(a.path)
    expect(json.sources).toEqual([a.path, b.path])
    expect(json.inputBytes).toBe(a.bytes + b.bytes)
  })
})

describe('failureJson', () => {
  it('carries the stable code, title, detail and hint, with an absolute path', () => {
    expect(failureJson({ path: '/a/ghost.jpg', error: fileNotFound('/a/ghost.jpg') })).toEqual({
      path: resolve('/a/ghost.jpg'),
      code: 'file-not-found',
      title: 'File not found',
      detail: 'ghost.jpg could not be found.',
      hint: 'Check the filename and try again.',
    })
  })

  it('omits path for a command-level failure, and hint when there is none', () => {
    const json = failureJson({ path: '', error: invalidArguments('No files given.') })
    expect(json).toEqual({
      code: 'invalid-arguments',
      title: 'Invalid arguments',
      detail: 'No files given.',
    })
  })
})

describe('runJson', () => {
  it('is ok only when nothing failed', async () => {
    const dir = await makeTempDir()
    const { result } = await convertOne(dir)
    expect(runJson('9.9.9', { results: [result], failures: [] }).ok).toBe(true)
    const failed = runJson('9.9.9', {
      results: [result],
      failures: [{ path: join(dir, 'x.jpg'), error: fileNotFound(join(dir, 'x.jpg')) }],
    })
    expect(failed.ok).toBe(false)
    expect(failed.forge).toBe('9.9.9')
  })

  it('serialises without glyphs or colour', async () => {
    const dir = await makeTempDir()
    const { result } = await convertOne(dir)
    const text = JSON.stringify(runJson('1', { results: [result], failures: [] }))
    expect(text).not.toMatch(/[✓✕⚠→]/)
    expect(text.includes(String.fromCharCode(27))).toBe(false)
  })

  it('errorJson is a run document holding one failure', () => {
    const doc = errorJson('1', invalidArguments('Bad.'))
    expect(doc).toEqual({
      forge: '1',
      ok: false,
      results: [],
      failures: [{ code: 'invalid-arguments', title: 'Invalid arguments', detail: 'Bad.' }],
    })
  })
})
