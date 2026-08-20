import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { degrees, PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import type { DocumentInfo, Job } from '../../src/core/types.js'
import { pdfEngine } from '../../src/engines/pdf.js'
import { probe } from '../../src/engines/registry.js'
import { makeMarkedPdf, makeTempDir } from '../helpers/fixtures.js'

async function doc(path: string): Promise<DocumentInfo> {
  const info = await probe(path)
  if (info.kind !== 'document') throw new Error('expected a document')
  return info
}

async function rotations(path: string): Promise<number[]> {
  const d = await PDFDocument.load(await readFile(path))
  return d.getPages().map((p) => p.getRotation().angle)
}

async function preRotated(dir: string, name: string, angle: number): Promise<string> {
  const path = await makeMarkedPdf(dir, name, [1, 2])
  const d = await PDFDocument.load(await readFile(path))
  for (const p of d.getPages()) p.setRotation(degrees(angle))
  await writeFile(path, await d.save())
  return path
}

describe('rotate', () => {
  it('turns every page by a quarter turn', async () => {
    const dir = await makeTempDir()
    const src = await makeMarkedPdf(dir, 'doc.pdf', [1, 2])
    const out = join(dir, 'out.pdf')
    const job: Job = { op: 'rotate', sources: [await doc(src)], outputs: [out], turns: 1 }
    await pdfEngine.run(job, () => {})
    expect(await rotations(out)).toEqual([90, 90])
  })

  it('adds to an existing rotation rather than replacing it', async () => {
    const dir = await makeTempDir()
    const src = await preRotated(dir, 'doc.pdf', 90)
    const out = join(dir, 'out.pdf')
    const job: Job = { op: 'rotate', sources: [await doc(src)], outputs: [out], turns: 1 }
    await pdfEngine.run(job, () => {})
    expect(await rotations(out)).toEqual([180, 180])
  })

  it('wraps past a full turn', async () => {
    const dir = await makeTempDir()
    const src = await preRotated(dir, 'doc.pdf', 270)
    const out = join(dir, 'out.pdf')
    const job: Job = { op: 'rotate', sources: [await doc(src)], outputs: [out], turns: 2 }
    await pdfEngine.run(job, () => {})
    expect(await rotations(out)).toEqual([90, 90])
  })

  /**
   * Spec §6: additive, "normalised to 0–270". JS `%` keeps the sign, so a
   * page stored at -270 — every value modulo 360 is legal in a PDF, and
   * other tools do write negatives — used to land at -180. Viewers render
   * that correctly, which is exactly why it would have gone unnoticed.
   */
  it('normalises a negatively stored rotation into 0-270', async () => {
    const dir = await makeTempDir()
    const src = await preRotated(dir, 'doc.pdf', -270)
    const out = join(dir, 'out.pdf')
    const job: Job = { op: 'rotate', sources: [await doc(src)], outputs: [out], turns: 1 }
    await pdfEngine.run(job, () => {})
    // -270 is a quarter turn; another quarter turn is a half turn.
    expect(await rotations(out)).toEqual([180, 180])
  })

  it('handles three-quarter turns', async () => {
    const dir = await makeTempDir()
    const src = await makeMarkedPdf(dir, 'doc.pdf', [1])
    const out = join(dir, 'out.pdf')
    const job: Job = { op: 'rotate', sources: [await doc(src)], outputs: [out], turns: 3 }
    await pdfEngine.run(job, () => {})
    expect(await rotations(out)).toEqual([270])
  })
})
