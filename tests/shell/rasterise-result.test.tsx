import { readdir } from 'node:fs/promises'
import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { makePdf, makeTempDir } from '../helpers/fixtures.js'

const ENTER = String.fromCharCode(13)
const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms))

const prefsFor = (dir: string) => ({
  ...DEFAULT_PREFERENCES,
  theme: 'dark' as const,
  defaultOutput: dir,
})

/**
 * `describePdfResult` switched on `job.op` and had no `convert` case, so a
 * rasterisation fell to its default — `done — ${first}` — and reported one
 * filename for however many pages were written. `reportSingle` handles the
 * same shape correctly, in the CLI. Two switches, one of them incomplete.
 */
describe('the result of rasterising a multi-page document', () => {
  it('reports how many files were written, not just the first', async () => {
    const dir = await makeTempDir()
    const file = await makePdf(dir, 'doc.pdf', 3)
    const { stdin, lastFrame } = render(
      <App initialWidth={100} initialHeight={24} prefs={prefsFor(dir)} />,
    )

    stdin.write(file)
    await settle()
    stdin.write(ENTER) // stage -> convert picker
    await settle(400)
    stdin.write(ENTER) // jpeg -> pages
    await settle()
    stdin.write(ENTER) // all pages -> resolution
    await settle()
    stdin.write(ENTER) // default dpi -> quality
    await settle()
    stdin.write(ENTER) // default quality -> destination
    await settle()
    stdin.write(ENTER) // accept destination -> runs
    await settle(6000)

    const written = (await readdir(dir)).filter((f) => f.endsWith('.jpg'))
    expect(written).toHaveLength(3)

    const frame = lastFrame() ?? ''
    expect(frame).toContain('3 files')
  }, 60_000)
})
