import { cp, mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { actionsFor } from '../../src/core/actions/index.js'
import { targetIdsFor } from '../../src/core/capabilities.js'
import { describeSource, probeFiles } from '../../src/core/probe-report.js'
import { probe } from '../../src/engines/registry.js'
import { makeJpeg, makePdf, makePng, makeTempDir } from '../helpers/fixtures.js'

const LOCKED = fileURLToPath(new URL('../fixtures/locked-hunter2.pdf', import.meta.url))

describe('describeSource', () => {
  it('reports an image with its dimensions and what it can become', async () => {
    const dir = await makeTempDir()
    const source = await probe(await makeJpeg(dir, 'a.jpg'))
    const report = describeSource(source)
    expect(report).toMatchObject({ kind: 'image', format: 'jpeg', path: source.path })
    expect(report.width).toBeGreaterThan(0)
    expect(report.pages).toBeUndefined()
    // Invariant 2: from the capability graph, never a list written here.
    expect(report.targets).toEqual(targetIdsFor(source))
    expect(report.actions).toEqual(actionsFor([source]).map((a) => a.id))
    expect(report.actions).toContain('convert')
  })

  it('reports a PDF with its page count, encryption, and page operations', async () => {
    const dir = await makeTempDir()
    const source = await probe(await makePdf(dir, 'doc.pdf', 3))
    const report = describeSource(source)
    expect(report).toMatchObject({ kind: 'document', format: 'pdf', pages: 3, encrypted: false })
    expect(report.width).toBeUndefined()
    expect(report.actions).toEqual(expect.arrayContaining(['split', 'extract', 'delete', 'rotate']))
    // Merge needs two or more files, so it never applies to one.
    expect(report.actions).not.toContain('merge')
  })

  it('says when a PDF is encrypted', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'forge-probe-'))
    const path = join(dir, 'locked.pdf')
    await cp(LOCKED, path)
    expect(describeSource(await probe(path)).encrypted).toBe(true)
  })

  it('reads the format from content, not the extension (invariant 3)', async () => {
    const dir = await makeTempDir()
    const png = await makePng(dir, 'b.png')
    const disguised = join(dir, 'really-a-png.jpg')
    await cp(png, disguised)
    expect(describeSource(await probe(disguised)).format).toBe('png')
  })
})

describe('probeFiles', () => {
  it('reports a missing file as a failure and keeps going', async () => {
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'a.jpg')
    const { probes, failures } = await probeFiles([jpg, join(dir, 'ghost.jpg')])
    expect(probes.map((p) => p.path)).toEqual([jpg])
    expect(failures[0]?.error.code).toBe('file-not-found')
  })

  it('writes nothing', async () => {
    const dir = await makeTempDir()
    await makeJpeg(dir, 'a.jpg')
    await makePdf(dir, 'doc.pdf', 2)
    const before = (await readdir(dir)).sort()
    await probeFiles([dir])
    expect((await readdir(dir)).sort()).toEqual(before)
  })

  it('reads a real file whose name contains glob characters as that file', async () => {
    const dir = await makeTempDir()
    const pdf = await makePdf(dir, 'Scan [a] {b}.pdf', 2)
    const { probes, failures } = await probeFiles([pdf])
    expect(failures).toEqual([])
    expect(probes.map((p) => p.path)).toEqual([pdf])
  })
})
