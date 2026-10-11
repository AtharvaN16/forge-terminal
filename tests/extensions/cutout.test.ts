import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { beforeAll, describe, expect, it } from 'vitest'
import { isForgeError } from '../../src/core/errors.js'
import { runExtension } from '../../src/extensions/run.js'

function hasSwiftc(): boolean {
  if (process.platform !== 'darwin') return false
  try {
    execFileSync('swiftc', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

describe.skipIf(!hasSwiftc())('forge-cutout (real Apple Vision)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-cutout-'))
  const ext = { entry: join(dir, 'bin', 'forge-cutout'), kind: 'exec' as const }

  beforeAll(() => {
    execFileSync('sh', ['extensions/remove-background/build.sh', join(dir, 'bin')], {
      stdio: 'ignore',
    })
  }, 300_000)

  it('cuts a clear subject out of a flat background', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">
      <rect width="400" height="400" fill="#e8e8e8"/>
      <ellipse cx="200" cy="215" rx="95" ry="130" fill="#c0392b"/>
      <circle cx="200" cy="105" r="55" fill="#e0a070"/></svg>`
    const input = join(dir, 'subject.png')
    const out = join(dir, 'subject-cutout.png')
    await sharp(Buffer.from(svg)).png().toFile(input)
    const r = await runExtension(ext, [input, out])
    expect(r.width).toBe(400)
    const { data, info } = await sharp(out)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    const alpha = (x: number, y: number) => data[(y * info.width + x) * info.channels + 3]
    expect(alpha(2, 2)).toBeLessThan(10)
    expect(alpha(397, 397)).toBeLessThan(10)
    expect(alpha(200, 230)).toBeGreaterThan(245)
  })

  it('reports no-subject for a flat grey image', async () => {
    const input = join(dir, 'flat.png')
    await sharp({ create: { width: 200, height: 200, channels: 3, background: '#808080' } })
      .png()
      .toFile(input)
    const err = await runExtension(ext, [input, join(dir, 'flat-out.png')]).catch((e) => e)
    expect(isForgeError(err) && err.code).toBe('no-subject')
  })
})
