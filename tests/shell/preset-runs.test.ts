import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { type Preset, passesFor } from '../../src/core/preset.js'
import type { ImageInfo, SourceInfo } from '../../src/core/types.js'
import { passLabels, presetOutput, presetsFor } from '../../src/shell/preset-runs.js'

/** Running a saved preset next time (decided, mockups/presets-ux-2026-10-round10.html). */
const photo = {
  kind: 'image',
  path: '/Users/me/Pictures/IMG_2051.png',
  format: 'png',
  bytes: 15_000_000,
  width: 3000,
  height: 2000,
  hasAlpha: false,
  frames: 1,
} as ImageInfo
const webblog: Preset = {
  name: 'webblog',
  steps: { to: 'jpeg', quality: 80, resize: { width: 1920 } },
  saveTo: 'same',
}

describe('presetsFor: the presets that can run on what is staged', () => {
  it('offers an image preset for a photo, and none for a document', () => {
    expect(presetsFor([webblog], photo).map((p) => p.name)).toEqual(['webblog'])
    const doc = { kind: 'document', path: '/x/report.pdf', format: 'pdf', bytes: 1 } as SourceInfo
    expect(presetsFor([webblog], doc)).toEqual([])
  })

  it('leaves out a preset whose format this file cannot become', () => {
    const toPdf: Preset = { name: 'print', steps: { to: 'heic' as never }, saveTo: 'same' }
    expect(presetsFor([toPdf], photo)).toEqual([])
  })
})

describe('passLabels: what each pass of a run is called', () => {
  it('says a pass by the steps it carries: one encode can carry the convert and the resize', () => {
    expect(passLabels(passesFor(webblog.steps, 'png'), 'png')).toEqual([['JPEG 80', '1920 wide']])
  })

  it('says a cut, a model and the encode as their own passes', () => {
    const passes = passesFor({ to: 'png', trim: true, removeBackground: true }, 'png')
    expect(passLabels(passes, 'png')).toEqual([['Trim'], ['Remove background'], ['PNG']])
  })
})

describe('presetOutput: where a run’s file goes', () => {
  it('saves beside the file for Same location, named as the file, in the new format', () => {
    expect(presetOutput(webblog, photo, () => false)).toBe('/Users/me/Pictures/IMG_2051.jpg')
  })

  it('saves in the preset’s folder, ~ expanded', () => {
    const out = presetOutput({ ...webblog, saveTo: '/Users/me/Desktop' }, photo, () => false)
    expect(out).toBe(join('/Users/me/Desktop', 'IMG_2051.jpg'))
  })

  it('never writes over a file that is there, nor over the original', () => {
    const taken = new Set(['/Users/me/Pictures/IMG_2051.jpg'])
    expect(presetOutput(webblog, photo, (p) => taken.has(p))).toBe(
      '/Users/me/Pictures/IMG_2051 (1).jpg',
    )
    const same = { ...webblog, steps: { to: 'png' as const } }
    expect(presetOutput(same, photo, () => false)).toBe('/Users/me/Pictures/IMG_2051 (1).png')
  })
})
