import { cp, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { convertAction } from '../../src/core/actions/convert.js'
import { runJobs } from '../../src/core/run.js'
import type { DocumentInfo } from '../../src/core/types.js'
import { probe } from '../../src/engines/registry.js'

const FIXTURE = fileURLToPath(new URL('../fixtures/locked-hunter2.pdf', import.meta.url))

async function lockedPdfCopy(): Promise<DocumentInfo> {
  const dir = await mkdtemp(join(tmpdir(), 'forge-locked-engine-'))
  const path = join(dir, 'locked.pdf')
  await cp(FIXTURE, path)
  const source = await probe(path)
  if (source.kind !== 'document') throw new Error('expected a document')
  return source
}

/**
 * The CLI knows to ask for a password before it builds the job. The shell has
 * no such step and no password field at all (spec §8), so the refusal has to
 * live where both callers reach it — below `Action.plan()`, in the engine
 * that would otherwise fail with pdfium's own opaque load error and be
 * flattened into a generic `conversion-failed` by `runJobs`.
 */
describe('rasterising an encrypted PDF with no password', () => {
  it('is probed as encrypted', async () => {
    const source = await lockedPdfCopy()
    expect(source.encrypted).toBe(true)
  })

  it('surfaces encrypted-source, not conversion-failed, through runJobs', async () => {
    const source = await lockedPdfCopy()
    const jobs = convertAction.plan([source], {
      target: 'jpeg',
      pages: 'first',
      dpi: '72',
      destination: join(source.path, '..'),
    })

    const summary = await runJobs(jobs, {})

    expect(summary.results).toHaveLength(0)
    expect(summary.failures).toHaveLength(1)
    expect(summary.failures[0]?.error.code).toBe('encrypted-source')
    // The one thing the user can actually do about it.
    expect(summary.failures[0]?.error.hint).toContain('--password-stdin')
  })

  it('still rasterises when the job carries the right password', async () => {
    const source = await lockedPdfCopy()
    const jobs = convertAction.plan([source], {
      target: 'jpeg',
      pages: 'first',
      dpi: '72',
      destination: join(source.path, '..'),
    })
    const job = jobs[0]
    if (job?.op !== 'convert') throw new Error('expected a convert job')
    job.options.password = 'hunter2'

    const summary = await runJobs([job], {})

    expect(summary.failures).toEqual([])
    expect(summary.results).toHaveLength(1)
  })
})
