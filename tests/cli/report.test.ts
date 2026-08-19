import { describe, expect, it } from 'vitest'
import { reportBatch, reportFailures, reportFormats, reportSingle } from '../../src/cli/report.js'
import { fileNotFound } from '../../src/core/errors.js'
import { buildPlan } from '../../src/core/plan.js'
import { resolveInputs } from '../../src/core/resolve.js'
import { runJobs } from '../../src/core/run.js'
import type { ConvertOptions } from '../../src/core/types.js'
import { makeJpeg, makeTempDir } from '../helpers/fixtures.js'

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
})
