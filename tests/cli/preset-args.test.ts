import { existsSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { parseArgs } from '../../src/cli/args.js'
import { execute } from '../../src/cli/execute.js'
import { savePreferences } from '../../src/config/preferences.js'
import { type ForgeError, isForgeError } from '../../src/core/errors.js'
import type { Preset } from '../../src/core/preset.js'
import { makeTempDir } from '../helpers/fixtures.js'

function refusalOf(argv: string[]): ForgeError | undefined {
  try {
    parseArgs(argv)
  } catch (e) {
    if (isForgeError(e)) return e
    throw e
  }
  return undefined
}

async function photo(dir: string): Promise<string> {
  const path = join(dir, 'photo.png')
  await sharp({ create: { width: 400, height: 200, channels: 3, background: '#336699' } })
    .png()
    .toFile(path)
  return path
}

const blog = (saveTo: string): Preset => ({
  name: 'blog',
  steps: { to: 'webp', quality: 80, resize: { width: 100 } },
  saveTo,
})

describe('--preset', () => {
  it('becomes a preset intent', () => {
    expect(parseArgs(['photo.png', '--preset', 'blog'])).toMatchObject({
      kind: 'preset',
      inputs: ['photo.png'],
      name: 'blog',
    })
  })

  it('refuses another operation alongside it: the preset already says what to do', () => {
    const e = refusalOf(['photo.png', '--preset', 'blog', '--to', 'jpeg'])
    expect(e?.code).toBe('invalid-arguments')
    expect(e?.message).toContain('--preset')
  })

  it('runs the saved preset beside the source when it saves to the same location', async () => {
    const dir = await makeTempDir()
    const source = await photo(dir)
    await savePreferences({ presets: [blog('same')] })
    const out = await execute(parseArgs([source, '--preset', 'blog']))
    expect(out.exitCode).toBe(0)
    const meta = await sharp(join(dir, 'photo.webp')).metadata()
    expect([meta.format, meta.width]).toEqual(['webp', 100])
  })

  it('saves to the preset’s folder, and --output wins over it', async () => {
    const dir = await makeTempDir()
    const away = await makeTempDir()
    const other = await makeTempDir()
    const source = await photo(dir)
    await savePreferences({ presets: [blog(away)] })
    await execute(parseArgs([source, '--preset', 'blog']))
    expect(existsSync(join(away, 'photo.webp'))).toBe(true)
    await execute(parseArgs([source, '--preset', 'blog', '--output', other]))
    expect(existsSync(join(other, 'photo.webp'))).toBe(true)
  })

  it('never writes over the original: same name and format becomes photo (1).png', async () => {
    const dir = await makeTempDir()
    const source = await photo(dir)
    await savePreferences({
      presets: [{ name: 'small', steps: { resize: { width: 100 } }, saveTo: 'same' }],
    })
    const out = await execute(parseArgs([source, '--preset', 'small']))
    expect(out.exitCode).toBe(0)
    expect((await sharp(join(dir, 'photo (1).png')).metadata()).width).toBe(100)
    expect((await sharp(source).metadata()).width).toBe(400)
  })

  it('says so when no preset has that name — the command is wrong, so it exits 2', async () => {
    const dir = await makeTempDir()
    const source = await photo(dir)
    await savePreferences({ presets: [blog('same')] })
    const out = await execute(parseArgs([source, '--preset', 'nope']))
    expect(out.exitCode).toBe(2)
    expect(out.stderr.join('\n')).toContain('nope')
    expect(out.stderr.join('\n')).toContain('blog')
  })

  it('names the original in the report, not a temp file', async () => {
    const dir = await makeTempDir()
    const source = await photo(dir)
    await savePreferences({
      presets: [
        {
          name: 'two',
          steps: { to: 'webp', maxBytes: 50_000, crop: { w: 1, h: 1 } },
          saveTo: 'same',
        },
      ],
    })
    const out = await execute(parseArgs([source, '--preset', 'two']), { json: true })
    const report = JSON.parse(out.stdout.join(''))
    expect(JSON.stringify(report)).toContain('photo.png')
    expect(JSON.stringify(report)).not.toContain('forge-preset-')
  })
})
