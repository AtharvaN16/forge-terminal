import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { batchRows, planBatch, runBatch } from '../../src/core/batch.js'
import { probe } from '../../src/engines/registry.js'
import {
  makeCorruptFile,
  makeJpeg,
  makeNoiseImage,
  makePdf,
  makePng,
  makeTempDir,
  makeTiff,
} from '../helpers/fixtures.js'

const names = (paths: readonly string[]) => paths.map((p) => basename(p))

describe('planBatch, compress', () => {
  it('keeps each file’s format and names it -small, at the quality asked', async () => {
    const dir = await makeTempDir()
    const sources = [
      await probe(await makeJpeg(dir, 'a.jpg')),
      await probe(await makePng(dir, 'b.png')),
    ]
    const { jobs, left } = planBatch(sources, { op: 'compress', quality: 60 }, new Set())
    expect(left).toEqual([])
    expect(jobs.map((j) => names(j.outputs)[0])).toEqual(['a-small.jpg', 'b-small.png'])
    expect(jobs.map((j) => (j.op === 'convert' ? [j.target, j.options.quality] : []))).toEqual([
      ['jpeg', 60],
      ['png', 60],
    ])
  })

  it('leaves alone what has nothing to compress, and says why', async () => {
    const dir = await makeTempDir()
    const sources = [
      await probe(await makeTiff(dir, 'scan.tiff')),
      await probe(await makePdf(dir, 'text.pdf', 1)),
      await probe(await makeJpeg(dir, 'ok.jpg')),
    ]
    const { jobs, left } = planBatch(sources, { op: 'compress', quality: 80 }, new Set())
    expect(names(jobs.flatMap((j) => j.outputs))).toEqual(['ok-small.jpg'])
    expect(left.map((l) => `${basename(l.path)}: ${l.reason}`)).toEqual([
      'scan.tiff: TIFF is lossless',
      'text.pdf: no images to shrink',
    ])
  })

  it('numbers two files that would take one name', async () => {
    const one = await makeTempDir()
    const two = await makeTempDir()
    const out = await makeTempDir()
    const sources = [
      await probe(await makeJpeg(one, 'a.jpg')),
      await probe(await makeJpeg(two, 'a.jpg')),
    ]
    const { jobs } = planBatch(sources, { op: 'compress', quality: 80 }, new Set(), {
      destination: out,
    })
    expect(names(jobs.flatMap((j) => j.outputs))).toEqual(['a-small.jpg', 'a-small (1).jpg'])
  })
})

describe('planBatch, what is already there', () => {
  it('leaves a file whose output exists alone by default, as a folder dropped again', async () => {
    const dir = await makeTempDir()
    const source = await probe(await makeJpeg(dir, 'a.jpg'))
    await writeFile(join(dir, 'a-small.jpg'), 'there')
    const { jobs, left } = planBatch([source], { op: 'compress', quality: 80 }, new Set())
    expect(jobs).toEqual([])
    expect(left.map((l) => l.reason)).toEqual(['already compressed'])
  })

  it('asks: the jobs whose output exists come back as taken, not run', async () => {
    const dir = await makeTempDir()
    const a = await probe(await makeJpeg(dir, 'a.jpg'))
    const b = await probe(await makeJpeg(dir, 'b.jpg'))
    await writeFile(join(dir, 'a-small.jpg'), 'there')
    const plan = planBatch([a, b], { op: 'compress', quality: 80 }, new Set(), {
      existing: 'ask',
    })
    expect(names(plan.taken.flatMap((j) => j.outputs))).toEqual(['a-small.jpg'])
    expect(names(plan.jobs.flatMap((j) => j.outputs))).toEqual(['a-small.jpg', 'b-small.jpg'])
  })

  it('keeps both: numbers past what is on disk', async () => {
    const dir = await makeTempDir()
    const a = await probe(await makeJpeg(dir, 'a.jpg'))
    await writeFile(join(dir, 'a-small.jpg'), 'there')
    const plan = planBatch([a], { op: 'compress', quality: 80 }, new Set(), {
      existing: 'number',
    })
    expect(names(plan.jobs.flatMap((j) => j.outputs))).toEqual(['a-small (1).jpg'])
  })

  it('converts with each kind’s answer, as a folder does', async () => {
    const dir = await makeTempDir()
    const sources = [
      await probe(await makePng(dir, 'a.png')),
      await probe(await makePdf(dir, 'c.pdf', 1)),
    ]
    const { jobs, left } = planBatch(
      sources,
      { op: 'convert', answers: { images: { target: 'webp', quality: 80 } } },
      new Set(),
    )
    expect(names(jobs.flatMap((j) => j.outputs))).toEqual(['a.webp'])
    expect(left.map((l) => l.reason)).toEqual(['not an image'])
  })
})

describe('edit, several images', () => {
  it('resizes every image, keeping its format, and leaves what is not an image', async () => {
    const dir = await makeTempDir()
    const sources = [
      await probe(await makeNoiseImage(dir, 'a.png', 200, 'png')),
      await probe(await makeNoiseImage(dir, 'b.jpg', 300, 'jpeg')),
      await probe(await makePdf(dir, 'c.pdf', 1)),
    ]
    const recipe = { op: 'edit', tool: 'resize', resize: { percent: 50 } } as const
    const run = await runBatch(sources, recipe)
    const rows = batchRows(sources, run)
    expect(rows.map((r) => `${basename(r.path)} ${r.state} ${r.reason ?? ''}`)).toEqual([
      'a.png done ',
      'b.jpg done ',
      'c.pdf left images only',
    ])
    expect(names(rows.flatMap((r) => r.result?.job.outputs ?? []))).toEqual([
      'a-100x100.png',
      'b-150x150.jpg',
    ])
  })

  it('trims what has empty edges, and says when an image has none', async () => {
    const dir = await makeTempDir()
    const flat = await probe(await makePng(dir, 'flat.png'))
    const run = await runBatch([flat], { op: 'edit', tool: 'trim' })
    expect(batchRows([flat], run).map((r) => `${r.state} ${r.reason ?? ''}`)).toEqual([
      'left no empty edges',
    ])
  })

  it('leaves an image too large for the boost asked', async () => {
    const dir = await makeTempDir()
    const huge = { ...(await probe(await makePng(dir, 'huge.png'))), width: 9000, height: 6000 }
    const { jobs, left } = planBatch([huge], { op: 'edit', tool: 'boost', scale: 4 }, new Set())
    expect(jobs).toEqual([])
    expect(left.map((l) => l.reason)).toEqual(['too large for 4×'])
  })
})

describe('runBatch and batchRows', () => {
  it('compresses each file under a target size, and tells every file’s fate in order', async () => {
    const dir = await makeTempDir()
    const big = await probe(await makeNoiseImage(dir, 'big.jpg', 500, 'jpeg'))
    const tiny = await probe(await makeJpeg(dir, 'tiny.jpg'))
    const broken = await makeCorruptFile(dir, 'broken.jpg')
    const brokenSource = { ...big, path: broken }
    const lossless = await probe(await makeTiff(dir, 'scan.tiff'))
    const sources = [big, tiny, brokenSource, lossless]
    const target = Math.round(big.bytes / 2)
    const run = await runBatch(sources, { op: 'compress', targetBytes: target })
    const rows = batchRows(sources, run)
    expect(rows.map((r) => `${basename(r.path)} ${r.state}`)).toEqual([
      'big.jpg done',
      'tiny.jpg left',
      'broken.jpg failed',
      'scan.tiff left',
    ])
    const done = rows[0]
    expect(done?.result?.outputBytes).toBeLessThanOrEqual(target)
    expect(rows[1]?.reason).toBe('already under that size')
    expect(rows[3]?.reason).toBe('TIFF is lossless')
    expect(existsSync(join(dir, 'big-small.jpg'))).toBe(true)
  })

  it('stopped part-way: what finished is kept, and the rest are told as stopped', async () => {
    const dir = await makeTempDir()
    const sources = [
      await probe(await makeNoiseImage(dir, 'a.jpg', 200, 'jpeg')),
      await probe(await makeNoiseImage(dir, 'b.jpg', 200, 'jpeg')),
      await probe(await makeNoiseImage(dir, 'c.jpg', 200, 'jpeg')),
    ]
    const stop = new AbortController()
    const run = await runBatch(
      sources,
      { op: 'compress', quality: 40 },
      {
        concurrency: 1,
        signal: stop.signal,
        onEvent: (e) => {
          if (e.type === 'job:done') stop.abort()
        },
      },
    )
    expect(run.outcome.cancelled).toBe(true)
    expect(
      batchRows(sources, run).map((r) => `${basename(r.path)} ${r.state} ${r.reason ?? ''}`),
    ).toEqual(['a.jpg done ', 'b.jpg left stopped', 'c.jpg left stopped'])
    expect(existsSync(join(dir, 'a-small.jpg'))).toBe(true)
    expect(existsSync(join(dir, 'b-small.jpg'))).toBe(false)
  })

  it('says how small a file could get when the target is out of reach', async () => {
    const dir = await makeTempDir()
    const big = await probe(await makeNoiseImage(dir, 'noise.png', 300, 'png'))
    const run = await runBatch([big], { op: 'compress', targetBytes: 200 })
    const [row] = batchRows([big], run)
    expect(row?.state).toBe('left')
    expect(row?.reason).toMatch(/^can’t get below \d/)
  })
})
