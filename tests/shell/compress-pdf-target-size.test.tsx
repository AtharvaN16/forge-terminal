import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { makeScannedPdf, makeTempDir } from '../helpers/fixtures.js'

const ENTER = String.fromCharCode(13)
const DOWN = `${String.fromCharCode(27)}[B`
const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms))

/** Enters the compress flow, then drops a scan into it. */
async function toCompressScan() {
  const dir = await makeTempDir()
  const file = await makeScannedPdf(dir, 'scan.pdf', { dpi: 300, pages: 4 })
  const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const, defaultOutput: dir }
  const app = render(<App initialWidth={100} prefs={prefs} />)
  app.stdin.write('/compress')
  await settle()
  app.stdin.write(ENTER)
  await settle(200)
  app.stdin.write(file)
  await settle()
  app.stdin.write(ENTER)
  await settle(800)
  return { ...app, dir }
}

/**
 * The bug: `compressAction.appliesTo` accepts a PDF with compressible images,
 * so the shell offered "To a target size" for a scan and collected the number
 * — but `confirmDestination` routed every document to the multi-output path,
 * which never read `targetBytes`. The job reached the engine as a fixed
 * quality-60 / 150-dpi re-encode, and the user was told it was done.
 */
describe('compressing a PDF to a target size in the shell', () => {
  it('lands under the size that was asked for', async () => {
    const { stdin, dir } = await toCompressScan()

    stdin.write(DOWN) // To a target size
    await settle()
    stdin.write(ENTER)
    await settle()
    stdin.write('80kb')
    await settle()
    stdin.write(ENTER)
    await settle(500)

    // destination, then name
    stdin.write(ENTER)
    await settle(300)
    stdin.write(ENTER)
    await settle(6000)

    const written = (await readdir(dir)).find((f) => f !== 'scan.pdf' && f.endsWith('.pdf'))
    expect(written).toBeDefined()

    const { size } = await stat(join(dir, written ?? ''))
    expect(size).toBeLessThanOrEqual(80 * 1024)
    // And not absurdly under: a search that slammed to the lowest rung would
    // "succeed" while throwing away far more quality than was asked for.
    expect(size).toBeGreaterThan(80 * 1024 * 0.15)
  }, 60_000)

  /**
   * `runPdfJobs` pushed a bare note and never read `result.warnings`, so
   * `pdf-downsampled` — the loss actually worth naming — reached CLI users and
   * not shell users. Routing a compression through the ordinary result path
   * fixed it; this pins that it stays fixed.
   */
  it('shows the downsampling warning, which the CLI has always shown', async () => {
    const { stdin, lastFrame } = await toCompressScan()

    stdin.write(ENTER) // By quality
    await settle()
    stdin.write(ENTER) // accept the slider
    await settle()
    stdin.write(ENTER) // destination
    await settle(300)
    stdin.write(ENTER) // name
    await settle(6000)

    // A 300 dpi scan compressed at the 150 dpi default is downsampled, and
    // saying so is what lets the user pass a higher dpi if they cared.
    expect(lastFrame() ?? '').toMatch(/reduced from 300 to 150 dpi/i)
  }, 60_000)
})
