import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { reportBatch, reportFailures, reportFormats, reportSingle } from '../../src/cli/report.js'
import { readableFormats, writableFormats } from '../../src/core/capabilities.js'
import { fileNotFound } from '../../src/core/errors.js'
import { FORMATS } from '../../src/core/formats.js'
import { buildPlan } from '../../src/core/plan.js'
import { resolveInputs } from '../../src/core/resolve.js'
import { runJobs } from '../../src/core/run.js'
import type { ConvertOptions, Job } from '../../src/core/types.js'
import { probe } from '../../src/engines/registry.js'
import { makeJpeg, makeMarkedPdf, makeTempDir } from '../helpers/fixtures.js'

const options: ConvertOptions = { background: '#ffffff', keepMetadata: false }

async function convertAll(dir: string, count: number) {
  for (let i = 0; i < count; i++) await makeJpeg(dir, `f${i}.jpg`)
  const resolved = await resolveInputs([dir], { recursive: false })
  const plan = await buildPlan({ resolved, target: 'webp', options, force: false })
  return runJobs(plan.jobs, {})
}

describe('reportSingle', () => {
  it('shows the arrow, both sizes and the change', async () => {
    const dir = await makeTempDir()
    const text = reportSingle(await convertAll(dir, 1)).join('\n')
    expect(text).toContain('✓')
    expect(text).toContain('→')
    expect(text).toMatch(/f0\.jpg/)
    expect(text).toMatch(/f0\.webp/)
    expect(text).toMatch(/smaller|larger|same size/)
  })

  it('names every output for a multi-page PDF rasterisation, not just the first', async () => {
    // A single PDF rasterised to 3 pages is one *result* (one job, one
    // source) — `summary.results.length === 1` is exactly what routes
    // execute() to reportSingle rather than reportBatch, so this is the
    // shape that actually reaches it. Before this fix, reportSingle read
    // only `outputs[0]`: pages 2 and 3 were written correctly but silently
    // absent from what the CLI printed.
    const dir = await makeTempDir()
    const src = await makeMarkedPdf(dir, 'doc.pdf', [1, 2, 3])
    const info = await probe(src)
    if (info.kind !== 'document') throw new Error('expected a document')
    const job: Job = {
      op: 'convert',
      sources: [info],
      outputs: [join(dir, 'doc-1.jpg'), join(dir, 'doc-2.jpg'), join(dir, 'doc-3.jpg')],
      target: 'jpeg',
      options: { ...options, dpi: 72, pages: [0, 1, 2] },
    }
    const summary = await runJobs([job], {})
    const text = reportSingle(summary).join('\n')
    expect(text).toContain('3 files')
    expect(text).toContain('doc-1.jpg')
    expect(text).toContain('doc-2.jpg')
    expect(text).toContain('doc-3.jpg')
  })
})

describe('reportBatch', () => {
  it('counts the conversions and totals the bytes', async () => {
    const dir = await makeTempDir()
    const text = reportBatch(await convertAll(dir, 4)).join('\n')
    expect(text).toContain('4 converted')
    expect(text).toContain('→')
  })

  it('names the output directory when one was given', async () => {
    const dir = await makeTempDir()
    const text = reportBatch(await convertAll(dir, 2), './dist/').join('\n')
    expect(text).toContain('./dist/')
  })
})

describe('reportFailures', () => {
  it('renders each failure with a symbol and a word, not colour alone', () => {
    const text = reportFailures([{ path: '/a/ghost.jpg', error: fileNotFound('/a/ghost.jpg') }], {
      debug: false,
    }).join('\n')
    expect(text).toContain('✕ File not found')
    expect(text).toContain('ghost.jpg')
  })

  it('says nothing when there are no failures', () => {
    expect(reportFailures([], { debug: false })).toEqual([])
  })
})

describe('reportFormats', () => {
  it('lists what can be read and what can be written', () => {
    const text = reportFormats().join('\n')
    expect(text).toContain('HEIC')
    expect(text).toContain('WebP')
    expect(text.toLowerCase()).toContain('read')
    expect(text.toLowerCase()).toContain('write')
  })

  it('marks heic as read-only, since sharp cannot encode it', () => {
    const line = reportFormats().find((l) => l.includes('HEIC')) ?? ''
    expect(line.toLowerCase()).toContain('read only')
  })

  it('derives the read-only explanation from the capability table instead of hardcoding it', () => {
    const readable = new Set(readableFormats())
    const writable = new Set(writableFormats())
    const readOnly = [...readable].filter((id) => !writable.has(id)).map((id) => FORMATS[id].label)

    const lines = reportFormats()
    const note = lines.find((l) => l.toLowerCase().includes('read only because'))

    if (readOnly.length === 0) {
      expect(note).toBeUndefined()
      return
    }
    expect(note).toBeDefined()
    for (const label of readOnly) expect(note).toContain(label)
    // Nothing writable-and-readable should be named in the explanation.
    for (const id of writable) {
      if (readable.has(id)) expect(note).not.toContain(FORMATS[id].label)
    }
  })
})
