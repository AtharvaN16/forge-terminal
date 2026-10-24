import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { parseArgs } from '../../src/cli/args.js'
import { runIntent } from '../../src/cli/execute.js'
import { readableFormats, targetIdsFor } from '../../src/core/capabilities.js'
import { FORMATS } from '../../src/core/formats.js'
import type { FormatId, SourceInfo } from '../../src/core/types.js'
import { probe } from '../../src/engines/registry.js'
import {
  makeAvif,
  makeDocx,
  makeJpeg,
  makePng,
  makeTempDir,
  makeTextPdf,
  makeTiff,
} from '../helpers/fixtures.js'
import { ffmpegHere, makeClip } from '../helpers/media.js'
import { makeDng } from '../helpers/raw.js'

/**
 * Format parity: every format Forge reads becomes every target Forge offers
 * for it, on this OS, through the CLI's own path (`parseArgs` → `runIntent`).
 * CI runs this file on macOS, Windows and Linux, so a failing pair names
 * itself and the runner names the OS.
 *
 * Nothing here lists the targets: they come from `targetIdsFor` of the
 * probed fixture (invariant 2). What this file does list is how to make one
 * small file of each readable format, and `readableFormats()` is checked
 * against that list, so a format Forge learns to read fails here until it
 * has a fixture.
 */

const run = promisify(execFile)
const fixtures = join(process.cwd(), 'tests', 'fixtures')

/**
 * HEIC and RAW decode through `sips` on a Mac and through the heic and raw
 * extensions elsewhere. Off a Mac, the real payloads are built and installed
 * into a config folder of this file's own, the layout `installed()` reads.
 * Set before anything probes, so every lookup sees it.
 */
process.env.XDG_CONFIG_HOME = await makeTempDir()

/** Builds and installs the real payload; a build that fails fails its row. */
async function installExtension(id: 'heic' | 'raw'): Promise<void> {
  const dir = join(process.env.XDG_CONFIG_HOME as string, 'forge', 'extensions', id, '1.0.0')
  await run(process.execPath, [join(process.cwd(), 'extensions', id, 'build.mjs'), '--out', dir])
  const manifest = {
    id,
    version: '1.0.0',
    entry: 'runner.mjs',
    kind: 'node',
    files: { 'runner.mjs': '' },
  }
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest))
  await writeFile(join(dirname(dir), 'current'), '1.0.0')
}

const mac = process.platform === 'darwin'
/** Why HEIC and RAW cannot be decoded here: only a Mac without sips. */
const noDecoder = mac && !existsSync('/usr/bin/sips') ? 'sips is missing' : undefined
/** Off a Mac, each source's fixture waits for its extension first. */
const decoder = (id: 'heic' | 'raw'): Promise<void> =>
  mac ? Promise.resolve() : installExtension(id)
const [heicReady, rawReady] = [decoder('heic'), decoder('raw')]
// Awaited by the fixture; caught here too so a failed build is never unhandled.
heicReady.catch(() => {})
rawReady.catch(() => {})

const NO_FFMPEG = 'ffmpeg is not on PATH'

/** A copy of a checked-in fixture, so outputs land beside nothing shared. */
async function copyOf(name: string): Promise<string> {
  const to = join(await makeTempDir(), name.split('/').pop() as string)
  await copyFile(join(fixtures, name), to)
  return to
}

/** Three frames, so a GIF source is an animation, and even sides for H.264. */
async function makeGif(dir: string): Promise<string> {
  const path = join(dir, 'anim.gif')
  const [w, h, frames] = [32, 16, 3]
  const strip = Buffer.concat(
    Array.from({ length: frames }, (_, i) => Buffer.alloc(w * h * 3, 60 * (i + 1))),
  )
  await sharp(strip, { raw: { width: w, height: h * frames, channels: 3, pageHeight: h } })
    .gif()
    .toFile(path)
  return path
}

const clip = (ext: string) => () => makeClip({ seconds: 1, width: 64, height: 48, fps: 10, ext })
const sound = (ext: string) => () => makeClip({ seconds: 1, soundOnly: true, ext })

interface Fixture {
  make: () => Promise<string>
  /** Why this source cannot run here; it is skipped, never failed. */
  skip?: string
}

/** One small file per readable format. Its extension is only its name: probing reads bytes. */
const FIXTURES: Partial<Record<FormatId, Fixture>> = {
  jpeg: { make: async () => makeJpeg(await makeTempDir(), 'photo.jpg') },
  png: { make: async () => makePng(await makeTempDir(), 'picture.png') },
  webp: {
    make: async () => {
      const path = join(await makeTempDir(), 'picture.webp')
      await sharp({ create: { width: 40, height: 20, channels: 4, background: '#33669980' } })
        .webp()
        .toFile(path)
      return path
    },
  },
  avif: { make: async () => makeAvif(await makeTempDir(), 'picture.avif') },
  // 64×48, made once by sips (tests/fixtures/README.md): the same file on every OS.
  heic: {
    make: async () => {
      await heicReady
      return copyOf('heic/small.heic')
    },
    skip: noDecoder,
  },
  // 320×240: big enough for macOS to read as RAW, and LibRaw reads it too.
  raw: {
    make: async () => {
      await rawReady
      return makeDng(await makeTempDir(), 'shot.dng')
    },
    skip: noDecoder,
  },
  gif: { make: async () => makeGif(await makeTempDir()) },
  tiff: { make: async () => makeTiff(await makeTempDir(), 'scan.tif') },
  pdf: {
    make: async () => makeTextPdf(await makeTempDir(), 'paper.pdf', ['Hello from Forge.']),
  },
  docx: { make: async () => makeDocx(await makeTempDir(), 'letter.docx') },
  // Made once by textutil (tests/fixtures/README.md): Windows and Linux have nothing to make one.
  doc: { make: () => copyOf('word/small.doc') },
  mp4: { make: clip('mp4'), skip: ffmpegHere ? undefined : NO_FFMPEG },
  mov: { make: clip('mov'), skip: ffmpegHere ? undefined : NO_FFMPEG },
  webm: { make: clip('webm'), skip: ffmpegHere ? undefined : NO_FFMPEG },
  mkv: { make: clip('mkv'), skip: ffmpegHere ? undefined : NO_FFMPEG },
  avi: { make: clip('avi'), skip: ffmpegHere ? undefined : NO_FFMPEG },
  mp3: { make: sound('mp3'), skip: ffmpegHere ? undefined : NO_FFMPEG },
  m4a: { make: sound('m4a'), skip: ffmpegHere ? undefined : NO_FFMPEG },
  opus: { make: sound('opus'), skip: ffmpegHere ? undefined : NO_FFMPEG },
  flac: { make: sound('flac'), skip: ffmpegHere ? undefined : NO_FFMPEG },
  aiff: { make: sound('aiff'), skip: ffmpegHere ? undefined : NO_FFMPEG },
  wav: { make: sound('wav'), skip: ffmpegHere ? undefined : NO_FFMPEG },
  ogg: { make: sound('ogg'), skip: ffmpegHere ? undefined : NO_FFMPEG },
}

/** What a source came to before any pair runs: its probe, or why it has no pairs. */
type Row =
  | { from: FormatId; source: SourceInfo; targets: FormatId[] }
  | { from: FormatId; skip: string }
  | { from: FormatId; error: unknown }

const rows: Row[] = await Promise.all(
  readableFormats().map(async (from): Promise<Row> => {
    const fixture = FIXTURES[from]
    if (!fixture) return { from, error: new Error(`no fixture for ${from}: add one to FIXTURES`) }
    if (fixture.skip) return { from, skip: fixture.skip }
    try {
      const source = await probe(await fixture.make())
      return { from, source, targets: targetIdsFor(source) }
    } catch (error) {
      return { from, error }
    }
  }),
)

/** A target that needs ffmpeg to write: any video or sound format. */
const needsFfmpeg = (target: FormatId) => FORMATS[target].media !== undefined

/** What an output of `target` probes as. HEVC is a codec carried in an MP4. */
const probesAs = (target: FormatId): FormatId => (target === 'hevc' ? 'mp4' : target)

async function convert(source: SourceInfo, target: FormatId): Promise<string[]> {
  const out = join(await makeTempDir(), 'out')
  await mkdir(out)
  const intent = parseArgs([source.path, '--to', target, '--output', out])
  if (intent.kind !== 'convert') throw new Error(`parsed as ${intent.kind}, not convert`)
  const report = await runIntent(intent)
  expect(report.failures.map((f) => f.error.message)).toEqual([])
  expect(report.results).toHaveLength(1)
  return report.results[0]?.job.outputs ?? []
}

/** The picture's size, whatever carries it: an image's pixels or a video's frame. */
function pictureSize(info: SourceInfo): { width: number; height: number } | undefined {
  if (info.kind === 'image') return { width: info.width, height: info.height }
  const video = info.kind === 'media' ? info.facts?.video : undefined
  return video ? { width: video.width, height: video.height } : undefined
}

describe(`format matrix on ${process.platform}`, () => {
  for (const row of rows) {
    if ('skip' in row) {
      it.skip(`${row.from} → every target (${row.skip})`, () => {})
      continue
    }
    if ('error' in row) {
      it(`${row.from} probes`, () => {
        throw row.error
      })
      continue
    }

    it(`${row.from} probes as ${row.from} and offers targets`, () => {
      expect(row.source.format).toBe(row.from)
      expect(row.targets.length).toBeGreaterThan(0)
    })

    const { source } = row
    for (const target of row.targets) {
      const name = `${row.from} → ${target}`
      if (needsFfmpeg(target) && !ffmpegHere) {
        it.skip(`${name} (${NO_FFMPEG})`, () => {})
        continue
      }
      it(name, async () => {
        const outputs = await convert(source, target)
        expect(outputs.length).toBeGreaterThan(0)
        for (const output of outputs) {
          expect(existsSync(output), `${output} exists`).toBe(true)
          const written = await probe(output)
          expect(written.format).toBe(probesAs(target))

          if (target === 'hevc') {
            expect(written.kind === 'media' && written.facts?.video?.codec).toBe('hevc')
          }
          if (FORMATS[target].media === 'sound') {
            expect(written.kind === 'media' && written.facts?.audio).toBeTruthy()
            expect(written.kind === 'media' && written.facts?.video).toBeFalsy()
          }
          // A picture keeps its size, into a picture or a video. A PDF's
          // pages have no size of their own to keep: they are drawn at a dpi.
          const before = pictureSize(source)
          const after = pictureSize(written)
          if (before && after) expect(after).toEqual(before)
        }
      }, 60_000)
    }
  }
})
