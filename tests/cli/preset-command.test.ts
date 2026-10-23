import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PresetIntent } from '../../src/cli/args.js'
import { runPresetCommand } from '../../src/cli/preset-command.js'
import { savePreferences } from '../../src/config/preferences.js'
import { makeGradientPng, makeTempDir } from '../helpers/fixtures.js'

/**
 * `--preset` and the right-click menu's preset items (which run it with
 * `keepBoth`): a click in Finder has no one to ask Replace or Keep both, so
 * it keeps both, as Sharpen in Forge does.
 */
const saved = process.env.XDG_CONFIG_HOME
beforeEach(async () => {
  process.env.XDG_CONFIG_HOME = await mkdtemp(join(tmpdir(), 'forge-cfg-'))
  await savePreferences({
    presets: [
      {
        name: 'webblog',
        steps: { to: 'jpeg', quality: 80, resize: { width: 16 } },
        saveTo: 'same',
      },
    ],
  })
})
afterEach(() => {
  if (saved === undefined) delete process.env.XDG_CONFIG_HOME
  else process.env.XDG_CONFIG_HOME = saved
})

const intent = (inputs: string[], o: Partial<PresetIntent> = {}): PresetIntent => ({
  kind: 'preset',
  inputs,
  name: 'webblog',
  force: false,
  recursive: false,
  debug: false,
  ...o,
})

describe('runPresetCommand', () => {
  it('runs the preset beside the file, as it says', async () => {
    const dir = await makeTempDir()
    const file = await makeGradientPng(dir, 'photo.png', 64)
    const report = await runPresetCommand(intent([file]))
    const out = report.results[0]?.job.outputs[0] as string
    expect(basename(out)).toBe('photo.jpg')
    expect((await sharp(out).metadata()).width).toBe(16)
  })

  it('keeps both when told to and the name is taken: photo (1).jpg, the first left alone', async () => {
    const dir = await makeTempDir()
    const file = await makeGradientPng(dir, 'photo.png', 64)
    await runPresetCommand(intent([file]))
    const report = await runPresetCommand(intent([file], { keepBoth: true }))
    expect(report.failures).toEqual([])
    expect(basename(report.results[0]?.job.outputs[0] as string)).toBe('photo (1).jpg')
  })
})
