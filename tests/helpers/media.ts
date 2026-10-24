import { execFile, execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { makeTempDir } from './fixtures.js'

const run = promisify(execFile)

/**
 * Whether this machine has ffmpeg. CI installs it on every runner
 * (.github/workflows/test.yml), but a machine without it must still pass, so
 * every test that encodes for real is `describe.skipIf(!ffmpegHere)`; the
 * arithmetic, the argument building and the parsing are tested everywhere.
 */
export const ffmpegHere: boolean = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore', timeout: 5000 })
    return true
  } catch {
    return false
  }
})()

export interface ClipSpec {
  seconds?: number
  width?: number
  height?: number
  fps?: number
  /** Sound beside the picture (a sine). False for a silent video. */
  audio?: boolean
  /** No picture at all: a sound file. */
  soundOnly?: boolean
  /** The file's extension, which picks the container: mov, mp4, webm, mkv, avi, wav, mp3, m4a, opus, flac, aiff, ogg. */
  ext?: string
  /** Display-matrix rotation to tag a video with, as a phone does. */
  rotate?: 90 | 180 | 270
  /** A keyframe every this many seconds (a phone's is about one); one at the start otherwise. */
  keyframes?: number
  /** x264's constant quality: high (45) for a file already squeezed hard. */
  crf?: number
}

/** A test clip made by ffmpeg's own sources: a moving test card and a tone. */
export async function makeClip(spec: ClipSpec = {}): Promise<string> {
  const {
    seconds = 2,
    width = 320,
    height = 240,
    fps = 30,
    audio = true,
    soundOnly = false,
    ext = soundOnly ? 'wav' : 'mov',
    rotate,
    keyframes,
    crf,
  } = spec
  const out = join(await makeTempDir(), `clip.${ext}`)
  const args = ['-hide_banner', '-loglevel', 'error', '-y']
  if (!soundOnly) args.push('-f', 'lavfi', '-i', `testsrc2=size=${width}x${height}:rate=${fps}`)
  if (audio || soundOnly) args.push('-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000')
  args.push('-t', String(seconds))
  if (!soundOnly) {
    if (ext === 'webm') args.push('-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8')
    else args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p')
    if (keyframes) args.push('-g', String(Math.round(keyframes * fps)), '-keyint_min', '1')
    if (crf !== undefined) args.push('-crf', String(crf))
  }
  if (audio || soundOnly) {
    if (ext === 'webm') args.push('-c:a', 'libopus')
    else if (ext === 'wav') args.push('-c:a', 'pcm_s16le')
    else if (ext === 'mp3') args.push('-c:a', 'libmp3lame')
    else if (ext === 'ogg') args.push('-c:a', 'libvorbis')
    else if (ext === 'opus') args.push('-c:a', 'libopus')
    else if (ext === 'flac') args.push('-c:a', 'flac')
    else if (ext === 'aiff') args.push('-c:a', 'pcm_s16be')
    else if (ext === 'avi') args.push('-c:a', 'libmp3lame')
    else args.push('-c:a', 'aac')
  }
  if (!rotate) {
    args.push(out)
    await run('ffmpeg', args)
    return out
  }
  // ffmpeg 7 takes -display_rotation as an input option: encode, then tag a copy.
  const plain = out.replace(/\.(\w+)$/, '.plain.$1')
  await run('ffmpeg', [...args, plain])
  await run('ffmpeg', [
    ...['-hide_banner', '-loglevel', 'error', '-y'],
    ...['-display_rotation', String(-rotate), '-i', plain, '-c', 'copy', out],
  ])
  return out
}
