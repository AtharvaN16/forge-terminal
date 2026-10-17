import { join } from 'node:path'
import { render } from 'ink-testing-library'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { makeGradientPng, makePdf, makeTempDir } from '../helpers/fixtures.js'

const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms))
const prefs = (dir: string) => ({
  ...DEFAULT_PREFERENCES,
  theme: 'dark' as const,
  defaultOutput: dir,
})

async function jpeg() {
  const dir = await makeTempDir()
  const file = join(dir, 'photo.jpg')
  await sharp(await makeGradientPng(dir, 'smooth.png', 128))
    .jpeg({ quality: 95 })
    .toFile(file)
  return { dir, file }
}

describe('the shell, opened from the right-click menu', () => {
  it('Compress in Forge: the file staged and compress’s first question asked', async () => {
    const { dir, file } = await jpeg()
    const { lastFrame } = render(
      <App
        initialWidth={100}
        prefs={prefs(dir)}
        opened={{ paths: [file], mode: 'compress', advance: true }}
      />,
    )
    await settle()
    const frame = lastFrame() ?? ''
    expect(frame).toContain('By quality')
    expect(frame).toContain('To a target size')
  })

  it('Convert in Forge: the file staged and the format list open', async () => {
    const { dir, file } = await jpeg()
    const { lastFrame } = render(
      <App
        initialWidth={100}
        prefs={prefs(dir)}
        opened={{ paths: [file], mode: 'convert', advance: true }}
      />,
    )
    await settle()
    expect(lastFrame() ?? '').toContain('Convert to')
  })

  it('Open in Forge on a PDF: staged on home in PDF mode, waiting for ↵', async () => {
    const dir = await makeTempDir()
    const pdf = await makePdf(dir, 'notes.pdf', 3)
    const { lastFrame } = render(
      <App
        initialWidth={100}
        prefs={prefs(dir)}
        opened={{ paths: [pdf], mode: 'pdf', advance: false }}
      />,
    )
    await settle()
    const frame = lastFrame() ?? ''
    expect(frame).toContain('notes.pdf')
    expect(frame).toMatch(/↵\s+pdf/)
  })

  it('waits for the first-run theme question before taking the first step', async () => {
    const { dir, file } = await jpeg()
    const { lastFrame } = render(
      <App
        initialWidth={100}
        prefs={{ ...prefs(dir), theme: undefined }}
        opened={{ paths: [file], mode: 'compress', advance: true }}
      />,
    )
    await settle()
    expect(lastFrame() ?? '').not.toContain('By quality')
  })
})
