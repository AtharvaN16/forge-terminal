import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { convertAction } from '../../src/core/actions/index.js'
import { sameFile } from '../../src/core/output-path.js'
import type { ImageInfo, Job, MediaInfo } from '../../src/core/types.js'
import { checkWriteSafety } from '../../src/core/write-safety.js'
import { makeTempDir } from '../helpers/fixtures.js'

// A Mac's disk ignores case: `clip.MP4` and `clip.mp4` are one file. An iPhone
// names its recordings `.MP4`, and HEVC is written into an `.mp4`.
async function caseInsensitiveDir(): Promise<string | undefined> {
  const dir = await makeTempDir()
  await writeFile(join(dir, 'probe.TXT'), 'x')
  return existsSync(join(dir, 'probe.txt')) ? dir : undefined
}

const image = (path: string): ImageInfo => ({
  kind: 'image',
  path,
  format: 'png',
  bytes: 1000,
  width: 10,
  height: 10,
  hasAlpha: false,
  frames: 1,
})

describe('the same file under a name spelt differently', () => {
  it('sameFile: one path, two spellings, or two names for one file', async () => {
    expect(sameFile('/a/b.png', '/a/./b.png')).toBe(true)
    expect(sameFile('/a/b.png', '/a/c.png')).toBe(false)
    const dir = await caseInsensitiveDir()
    if (!dir) return
    await writeFile(join(dir, 'Photo.PNG'), 'x')
    expect(sameFile(join(dir, 'Photo.PNG'), join(dir, 'photo.png'))).toBe(true)
  })

  it('refuses an output that is the input under another case', async () => {
    const dir = await caseInsensitiveDir()
    if (!dir) return
    const source = join(dir, 'Photo.PNG')
    await writeFile(source, 'x')
    const job: Job = {
      op: 'convert',
      sources: [image(source)],
      outputs: [join(dir, 'photo.png')],
      target: 'png',
      options: { background: '#ffffff', keepMetadata: false },
    }
    const { jobs, failures } = checkWriteSafety([job], { force: false })
    expect(jobs).toEqual([])
    expect(failures[0]?.error.code).toBe('output-is-input')
  })

  it('writes HEVC beside an iPhone .MP4 rather than onto it', async () => {
    const dir = await caseInsensitiveDir()
    if (!dir) return
    const path = join(dir, 'ScreenRecording_1.MP4')
    await writeFile(path, 'x')
    const clip: MediaInfo = { kind: 'media', path, format: 'mp4', bytes: 1 }
    const [job] = convertAction.plan([clip], { target: 'hevc' })
    const output = job?.outputs[0] ?? ''
    expect(sameFile(output, path)).toBe(false)
    expect(output.endsWith('.mp4')).toBe(true)
  })
})
