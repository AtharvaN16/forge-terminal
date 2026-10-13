import { join } from 'node:path'
import chalk from 'chalk'
import { Box } from 'ink'
import { render } from 'ink-testing-library'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ImageInfo } from '../../src/core/types.js'
import { CropStep } from '../../src/shell/components/CropStep.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { DARK, modePalette } from '../../src/shell/theme.js'
import { makeTempDir } from '../helpers/fixtures.js'

/** How often the picture is drawn: it should be only when the crop or the picture changes. */
const drawn = vi.hoisted(() => ({ count: 0 }))
vi.mock('../../src/shell/crop-art.js', async (original) => {
  const real = await original<typeof import('../../src/shell/crop-art.js')>()
  return {
    ...real,
    cropPictureRows: (...args: Parameters<typeof real.cropPictureRows>) => {
      drawn.count++
      return real.cropPictureRows(...args)
    },
  }
})

/** The crop preview on its own, at sizes and in states the whole flow does not reach. */
const ESC = String.fromCharCode(27)
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')
const until = async (cond: () => boolean) => {
  for (let i = 0; i < 400 && !cond(); i++) await new Promise((r) => setTimeout(r, 25))
}

const level = chalk.level
beforeEach(() => {
  chalk.level = 3
})
afterEach(() => {
  chalk.level = level
})

/** 1200 × 600 grey, a red disc on the right: attention's square is the right half. */
async function photoAt(path: string): Promise<void> {
  const disc = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600"><circle cx="1000" cy="300" r="150" fill="#e8201a"/></svg>',
  )
  await sharp({ create: { width: 1200, height: 600, channels: 3, background: '#808080' } })
    .composite([{ input: disc }])
    .png()
    .toFile(path)
}

const imageAt = (path: string): ImageInfo => ({
  kind: 'image',
  path,
  format: 'png',
  bytes: 1,
  width: 1200,
  height: 600,
  hasAlpha: false,
  frames: 1,
})

const SHAPE = { w: 1, h: 1, label: '1:1' }
const quiet = () => {}

function tree(source: ImageInfo, width: number) {
  // A new palette object each time, as the App's `modePalette` makes on every render.
  return (
    <ThemeProvider palette={modePalette(DARK, 'enhance')}>
      <Box height={20} flexDirection="column">
        <CropStep
          mode="enhance"
          source={source}
          shape={SHAPE}
          onSubmit={quiet}
          onCancel={quiet}
          width={width}
        />
      </Box>
    </ThemeProvider>
  )
}

function step(source: ImageInfo, width: number) {
  const app = render(tree(source, width))
  return { app, frame: () => (app.lastFrame() ?? '').replace(SGR, '') }
}

describe('the crop preview', () => {
  it('keeps the facts and says where the crop sits when there is no room for a picture', async () => {
    const dir = await makeTempDir()
    // Unreadable, so the crop is the largest box, centred: left 300.
    const { app, frame } = step(imageAt(join(dir, 'missing.png')), 30)
    await until(() => frame().includes('left 300 px'))
    expect(frame()).toContain('600 × 600 · 1:1')
    expect(frame()).toContain('keeps 50 % of the photo')
    expect(frame()).toContain('left 300 px · top 0 px')
    app.unmount()
  })

  it('reads the photo again after a failed read, on the next visit', async () => {
    chalk.level = 0 // the position line says where the guess put it
    const dir = await makeTempDir()
    const path = join(dir, 'late.png')
    const first = step(imageAt(path), 80)
    await until(() => first.frame().includes('left 300 px'))
    expect(first.frame()).toContain('left 300 px · top 0 px')
    first.app.unmount()

    // The file is there now: coming back reads it, and attention puts the square on the disc.
    await photoAt(path)
    const again = step(imageAt(path), 80)
    await until(() => again.frame().includes('left 600 px'))
    expect(again.frame()).toContain('left 600 px · top 0 px')
    again.app.unmount()
  }, 20_000)

  it('draws the picture again only when the crop moves, not on every render', async () => {
    const dir = await makeTempDir()
    const path = join(dir, 'still.png')
    await photoAt(path)
    const source = imageAt(path)
    const { app, frame } = step(source, 80)
    await until(() => frame().includes('▀'))
    await new Promise((r) => setTimeout(r, 100))
    const before = drawn.count
    // The App re-renders the step on each press it hears about: same props, same picture.
    for (let i = 0; i < 3; i++) app.rerender(tree(source, 80))
    await new Promise((r) => setTimeout(r, 100))
    expect(drawn.count).toBe(before)
    // A move draws it again.
    app.stdin.write(`${ESC}[D`)
    await until(() => drawn.count > before)
    expect(drawn.count).toBe(before + 1)
    app.unmount()
  }, 20_000)
})
