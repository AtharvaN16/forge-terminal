import { stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PDFDocument, rgb } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { parseArgs } from '../../src/cli/args.js'
import { execute } from '../../src/cli/execute.js'
import { makeTempDir } from '../helpers/fixtures.js'

/**
 * A page of fine, high-contrast detail. A flat fill is the wrong fixture for
 * a quality assertion: JPEG encodes one solid colour to roughly the same
 * handful of bytes at every quality, so a `--quality` that never arrives and
 * a `--quality` that does look identical on disk.
 *
 * Deterministic (a fixed multiplier, no `Math.random`) so a failure is
 * reproducible rather than a coin toss on the byte threshold.
 */
async function makeDetailedPdf(dir: string, name: string): Promise<string> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([200, 200])
  let seed = 1
  for (let x = 0; x < 200; x += 4) {
    for (let y = 0; y < 200; y += 4) {
      seed = (seed * 1103515245 + 12345) % 2147483648
      const v = seed % 256
      page.drawRectangle({
        x,
        y,
        width: 4,
        height: 4,
        color: rgb(v / 255, ((v * 7) % 256) / 255, ((v * 13) % 256) / 255),
      })
    }
  }
  const path = join(dir, name)
  await writeFile(path, await doc.save())
  return path
}

/**
 * Every `ConvertOptions` field the CLI can set has to reach the job whatever
 * the source kind is. A document source is planned by `buildRasterJob` rather
 * than `buildPlan`, and a field it forgets to forward becomes a flag that
 * works for a JPEG and silently does nothing for a PDF — the same defect
 * `--background` already had, one flag over.
 */
describe('--quality for a document source', () => {
  it('changes the size of a rasterised page, as it does for an image', async () => {
    const low = await makeTempDir()
    const high = await makeTempDir()
    await makeDetailedPdf(low, 'doc.pdf')
    await makeDetailedPdf(high, 'doc.pdf')

    const lowOut = await execute(
      parseArgs([join(low, 'doc.pdf'), '--to', 'jpeg', '--quality', '5']),
    )
    const highOut = await execute(
      parseArgs([join(high, 'doc.pdf'), '--to', 'jpeg', '--quality', '95']),
    )

    expect(lowOut.stderr).toEqual([])
    expect(highOut.stderr).toEqual([])

    const lowBytes = (await stat(join(low, 'doc-1.jpg'))).size
    const highBytes = (await stat(join(high, 'doc-1.jpg'))).size
    expect(highBytes).toBeGreaterThan(lowBytes * 2)
  })
})
