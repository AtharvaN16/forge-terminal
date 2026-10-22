/**
 * Prints the batch screens as the app draws them, at 80 × 24: several files
 * through compress (one damaged, one lossless), to a target size, and in
 * convert. A check of the built flow, not a mockup.
 *
 *   FORGE_NO_FIND=1 npx tsx scripts/batch-screens.tsx
 */
import { join } from 'node:path'
import { render } from 'ink-testing-library'
// biome-ignore lint/correctness/noUnusedImports: tsx compiles this script's JSX to React.createElement.
import React from 'react'
import { DEFAULT_PREFERENCES } from '../src/config/preferences.js'
import { App } from '../src/shell/App.js'
import {
  makeCorruptFile,
  makeNoiseImage,
  makePdf,
  makeTempDir,
  makeTiff,
} from '../tests/helpers/fixtures.js'

const ESC = String.fromCharCode(27)
const ENTER = String.fromCharCode(13)
const DOWN = `${ESC}[B`
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')
const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms))

const dir = await makeTempDir()
const names = ['IMG_2041.jpg', 'IMG_2042.jpg', 'IMG_2043.jpg', 'IMG_2044.jpg', 'IMG_2045.jpg']
const paths: string[] = []
for (const [i, n] of names.entries()) paths.push(await makeNoiseImage(dir, n, 300 + i * 20, 'jpeg'))
paths.push(await makeTiff(dir, 'scan.tiff'))
await makeCorruptFile(dir, 'IMG_2046.jpg')
paths.push(join(dir, 'IMG_2046.jpg'))

async function session(title: string, keys: (string | number)[]) {
  const out = await makeTempDir()
  const app = render(
    <App
      initialWidth={80}
      initialHeight={24}
      prefs={{ ...DEFAULT_PREFERENCES, theme: 'dark', defaultOutput: out }}
    />,
  )
  await settle(1500)
  for (const k of keys) {
    if (typeof k === 'number') {
      await settle(k)
      console.log(`--- ${title}\n${(app.lastFrame() ?? '').replace(SGR, '')}`)
    } else {
      app.stdin.write(k)
      await settle(400)
    }
  }
  app.unmount()
}

await session('compress by quality', [
  '2',
  paths.join(' '),
  1200,
  ENTER,
  300,
  ENTER,
  300,
  ENTER,
  300,
  ENTER,
  4000,
])
await session('compress to a size', [
  '2',
  paths.join(' '),
  ENTER,
  DOWN,
  ENTER,
  300,
  '40kb',
  ENTER,
  ENTER,
  6000,
])
await session('convert', ['1', paths.join(' '), ENTER, 300, ENTER, ENTER, ENTER, 4000])
await session('edit', [
  '4',
  paths.slice(0, 5).join(' '),
  ENTER,
  1500,
  DOWN,
  DOWN,
  DOWN,
  DOWN,
  500,
  ENTER,
  500,
  ENTER,
  500,
  ENTER,
  4000,
])
const pdf = await makePdf(dir, 'deck.pdf', 2)
await session('convert, mixed', ['1', [...paths.slice(0, 3), pdf].join(' '), ENTER, 300])
process.exit(0)
