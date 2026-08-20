import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { DocumentInfo, ImageInfo, Job } from '../../src/core/types.js'
import { checkWriteSafety } from '../../src/core/write-safety.js'
import { makeTempDir } from '../helpers/fixtures.js'

const doc = (path: string, pages = 7): DocumentInfo => ({
  kind: 'document',
  path,
  format: 'pdf',
  bytes: 1000,
  pages,
  encrypted: false,
})

const image = (path: string): ImageInfo => ({
  kind: 'image',
  path,
  format: 'jpeg',
  bytes: 1000,
  width: 10,
  height: 10,
  hasAlpha: false,
  frames: 1,
})

describe('checkWriteSafety', () => {
  it("refuses an output that is also one of the job's own inputs", async () => {
    const dir = await makeTempDir()
    const a = join(dir, 'a.pdf')
    const b = join(dir, 'b.pdf')
    const job: Job = { op: 'merge', sources: [doc(a), doc(b)], outputs: [a] }

    const { jobs, failures } = checkWriteSafety([job], { force: false })

    expect(jobs).toEqual([])
    expect(failures).toHaveLength(1)
    expect(failures[0]?.error.code).toBe('output-is-input')
  })

  it('--force overrides output-is-input, matching buildPlan', async () => {
    const dir = await makeTempDir()
    const a = join(dir, 'a.pdf')
    const b = join(dir, 'b.pdf')
    const job: Job = { op: 'merge', sources: [doc(a), doc(b)], outputs: [a] }

    const { jobs, failures } = checkWriteSafety([job], { force: true })

    expect(failures).toEqual([])
    expect(jobs).toEqual([job])
  })

  it('refuses to replace a file that already exists on disk', async () => {
    const dir = await makeTempDir()
    const source = join(dir, 'source.pdf')
    const output = join(dir, 'out.pdf')
    await writeFile(output, 'already here')
    const job: Job = { op: 'rotate', sources: [doc(source)], outputs: [output], turns: 1 }

    const { jobs, failures } = checkWriteSafety([job], { force: false })

    expect(jobs).toEqual([])
    expect(failures).toHaveLength(1)
    expect(failures[0]?.error.code).toBe('output-exists')
  })

  it('--force allows replacing a file that already exists on disk', async () => {
    const dir = await makeTempDir()
    const source = join(dir, 'source.pdf')
    const output = join(dir, 'out.pdf')
    await writeFile(output, 'already here')
    const job: Job = { op: 'rotate', sources: [doc(source)], outputs: [output], turns: 1 }

    const { jobs, failures } = checkWriteSafety([job], { force: true })

    expect(failures).toEqual([])
    expect(jobs).toEqual([job])
  })

  it("refuses a collision between two jobs' outputs even with --force", async () => {
    const dir = await makeTempDir()
    const a = join(dir, 'a.pdf')
    const b = join(dir, 'b.pdf')
    const output = join(dir, 'same.pdf')
    const first: Job = { op: 'rotate', sources: [doc(a)], outputs: [output], turns: 1 }
    const second: Job = { op: 'rotate', sources: [doc(b)], outputs: [output], turns: 2 }

    const { jobs, failures } = checkWriteSafety([first, second], { force: true })

    expect(jobs).toEqual([first])
    expect(failures).toHaveLength(1)
    expect(failures[0]?.error.code).toBe('output-collision')
  })

  it('refuses a whole multi-output job, not just the colliding output, before writing any of them', async () => {
    const dir = await makeTempDir()
    const report = join(dir, 'report.pdf')
    const other = join(dir, 'other.pdf')
    // Claims report-2.pdf first, the same path splitAction would give its
    // second part.
    const blocker: Job = {
      op: 'rotate',
      sources: [doc(other)],
      outputs: [join(dir, 'report-2.pdf')],
      turns: 1,
    }
    const split: Job = {
      op: 'split',
      sources: [doc(report)],
      outputs: [join(dir, 'report-1.pdf'), join(dir, 'report-2.pdf'), join(dir, 'report-3.pdf')],
      cuts: [0, 3],
    }

    const { jobs, failures } = checkWriteSafety([blocker, split], { force: false })

    // The whole split job is refused — its first and third outputs, which
    // did not themselves collide with anything, are not "kept" either.
    expect(jobs).toEqual([blocker])
    expect(failures).toHaveLength(1)
    expect(failures[0]?.error.code).toBe('output-collision')
  })

  it('refuses a job whose own outputs list the same path twice, and writes nothing', async () => {
    const dir = await makeTempDir()
    const source = join(dir, 'source.pdf')
    const output = join(dir, 'out.pdf')
    // A hand-built extract job simulating a future caller (the shell's page
    // grid) that passed a duplicated page selection through the array
    // branch of `selectedPages`, which — unlike `parseRanges` — is not
    // deduped, so two of its outputs alias the same path.
    const job: Job = {
      op: 'extract',
      sources: [doc(source)],
      outputs: [output, output],
      pages: [2, 2],
      separate: true,
    }

    const { jobs, failures } = checkWriteSafety([job], { force: false })

    expect(jobs).toEqual([])
    expect(failures).toHaveLength(1)
    expect(failures[0]?.error.code).toBe('output-collision')
  })

  it('--force does not rescue a job whose own outputs collide with each other', async () => {
    const dir = await makeTempDir()
    const source = join(dir, 'source.pdf')
    const output = join(dir, 'out.pdf')
    const job: Job = {
      op: 'extract',
      sources: [doc(source)],
      outputs: [output, output],
      pages: [2, 2],
      separate: true,
    }

    const { jobs, failures } = checkWriteSafety([job], { force: true })

    expect(jobs).toEqual([])
    expect(failures).toHaveLength(1)
    expect(failures[0]?.error.code).toBe('output-collision')
  })

  /**
   * Both refusals used to offer `--output` as the way out. A page operation
   * refuses `--output` (see `cli/args.ts`), so for merge, split, extract,
   * delete and rotate that half of each hint named a flag the same run would
   * reject — leaving someone whose glob-merge collided with its own output
   * no non-destructive way forward at all.
   */
  it('does not advise --output when a page operation is refused', async () => {
    const dir = await makeTempDir()
    const a = join(dir, 'a.pdf')
    const b = join(dir, 'b.pdf')
    const output = join(dir, 'merged.pdf')
    await writeFile(output, 'already here')

    const exists = checkWriteSafety(
      [{ op: 'merge', sources: [doc(a), doc(b)], outputs: [output] }],
      { force: false },
    ).failures[0]?.error
    expect(exists?.code).toBe('output-exists')
    expect(exists?.hint).not.toContain('--output')
    expect(exists?.hint).toContain('--force')

    const isInput = checkWriteSafety([{ op: 'merge', sources: [doc(a), doc(b)], outputs: [a] }], {
      force: false,
    }).failures[0]?.error
    expect(isInput?.code).toBe('output-is-input')
    expect(isInput?.hint).not.toContain('--output')
    // Still names a way out that does not destroy anything.
    expect(isInput?.hint).toMatch(/move|rename/i)
  })

  it('still advises --output when a conversion is refused', async () => {
    const dir = await makeTempDir()
    const source = join(dir, 'photo.jpg')
    const output = join(dir, 'photo.webp')
    await writeFile(output, 'already here')
    const job: Job = {
      op: 'convert',
      sources: [image(source)],
      outputs: [output],
      target: 'webp',
      options: { background: '#ffffff', keepMetadata: false },
    }

    const failure = checkWriteSafety([job], { force: false }).failures[0]?.error
    expect(failure?.code).toBe('output-exists')
    expect(failure?.hint).toContain('--output')
  })

  it('keeps a job whose outputs clear every rule', async () => {
    const dir = await makeTempDir()
    const source = join(dir, 'source.pdf')
    const output = join(dir, 'out.pdf')
    const job: Job = { op: 'rotate', sources: [doc(source)], outputs: [output], turns: 1 }

    const { jobs, failures } = checkWriteSafety([job], { force: false })

    expect(failures).toEqual([])
    expect(jobs).toEqual([job])
  })
})
