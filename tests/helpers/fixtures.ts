import { execFile } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import sharp from 'sharp'

const run = promisify(execFile)

export async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'forge-test-'))
}

export async function makePng(dir: string, name: string): Promise<string> {
  const path = join(dir, name)
  await sharp({ create: { width: 40, height: 20, channels: 3, background: '#c86432' } })
    .png()
    .toFile(path)
  return path
}

export async function makeTransparentPng(dir: string, name: string): Promise<string> {
  const path = join(dir, name)
  await sharp({
    create: { width: 32, height: 32, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0 } },
  })
    .png()
    .toFile(path)
  return path
}

export async function makeJpeg(dir: string, name: string): Promise<string> {
  const path = join(dir, name)
  await sharp({ create: { width: 40, height: 20, channels: 3, background: '#336699' } })
    .jpeg()
    .toFile(path)
  return path
}

/** Orientation 6 means "rotate 90° clockwise on display" — the classic phone-photo case. */
export async function makeOrientedJpeg(
  dir: string,
  name: string,
  orientation = 6,
): Promise<string> {
  const path = join(dir, name)
  const buffer = await sharp({
    create: { width: 40, height: 80, channels: 3, background: '#0000ff' },
  })
    .jpeg()
    .toBuffer()
  await sharp(buffer).withMetadata({ orientation }).jpeg().toFile(path)
  return path
}

/**
 * Sharp only treats raw input as multi-page when pageHeight sits inside the raw
 * options — the other three plausible spellings silently produce one tall frame.
 */
export async function makeAnimatedGif(dir: string, name: string, frames = 3): Promise<string> {
  const path = join(dir, name)
  const w = 8
  const h = 8
  const strip = Buffer.concat(
    Array.from({ length: frames }, (_, i) => Buffer.alloc(w * h * 3, 40 * (i + 1))),
  )
  await sharp(strip, { raw: { width: w, height: h * frames, channels: 3, pageHeight: h } })
    .gif()
    .toFile(path)
  return path
}

export async function makeCorruptFile(dir: string, name: string): Promise<string> {
  const path = join(dir, name)
  await writeFile(path, 'this is definitely not an image')
  return path
}

export async function makeAvif(dir: string, name: string): Promise<string> {
  const path = join(dir, name)
  await sharp({ create: { width: 24, height: 24, channels: 3, background: '#22aa55' } })
    .avif()
    .toFile(path)
  return path
}

/**
 * Sharp cannot encode HEIC, so the only way to get a genuine HEVC fixture is
 * macOS's built-in sips. Returns null elsewhere so tests can skip cleanly.
 */
export async function makeHeic(dir: string, name: string): Promise<string | null> {
  const source = await makePng(dir, `${name}.source.png`)
  const path = join(dir, name)
  try {
    await run('sips', ['-s', 'format', 'heic', source, '--out', path])
    return path
  } catch {
    return null
  }
}

export async function pixelAt(
  path: string,
  x: number,
  y: number,
): Promise<[number, number, number]> {
  const { data, info } = await sharp(path).raw().toBuffer({ resolveWithObject: true })
  const offset = (y * info.width + x) * info.channels
  return [data[offset] ?? 0, data[offset + 1] ?? 0, data[offset + 2] ?? 0]
}
