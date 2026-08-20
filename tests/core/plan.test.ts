import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { buildPlan } from '../../src/core/plan.js'
import { resolveInputs } from '../../src/core/resolve.js'
import type { ConvertOptions } from '../../src/core/types.js'
import { makeJpeg, makePng, makeTempDir } from '../helpers/fixtures.js'

const options: ConvertOptions = { background: '#ffffff', keepMetadata: false }

describe('buildPlan', () => {
  it('produces one job per source with a default output beside it', async () => {
    const dir = await makeTempDir()
    const a = await makeJpeg(dir, 'a.jpg')
    const resolved = await resolveInputs([a], { recursive: false })
    const plan = await buildPlan({ resolved, target: 'webp', options, force: false })
    expect(plan.jobs).toHaveLength(1)
    expect(plan.jobs[0]?.outputs[0]).toBe(join(dir, 'a.webp'))
  })

  it('rejects an impossible target and names the possible ones', async () => {
    const dir = await makeTempDir()
    const a = await makeJpeg(dir, 'a.jpg')
    const resolved = await resolveInputs([a], { recursive: false })
    const plan = await buildPlan({ resolved, target: 'heic', options, force: false })
    expect(plan.jobs).toHaveLength(0)
    expect(plan.failures[0]?.error.code).toBe('unsupported-target')
    expect(plan.failures[0]?.error.hint).toContain('webp')
  })

  it('refuses to overwrite an existing output without force', async () => {
    const dir = await makeTempDir()
    const a = await makeJpeg(dir, 'a.jpg')
    await makePng(dir, 'a.png')
    const resolved = await resolveInputs([a], { recursive: false })
    const plan = await buildPlan({ resolved, target: 'png', options, force: false })
    expect(plan.failures[0]?.error.code).toBe('output-exists')
  })

  it('allows the overwrite with force', async () => {
    const dir = await makeTempDir()
    const a = await makeJpeg(dir, 'a.jpg')
    await makePng(dir, 'a.png')
    const resolved = await resolveInputs([a], { recursive: false })
    const plan = await buildPlan({ resolved, target: 'png', options, force: true })
    expect(plan.jobs).toHaveLength(1)
  })

  it('refuses to write over its own input without force', async () => {
    const dir = await makeTempDir()
    const a = await makeJpeg(dir, 'a.jpg')
    const resolved = await resolveInputs([a], { recursive: false })
    const plan = await buildPlan({ resolved, target: 'jpeg', options, force: false })
    expect(plan.failures[0]?.error.code).toBe('output-is-input')
  })

  it('refuses two sources that would clobber the same output, keeping only one job', async () => {
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'logo.jpg')
    const webp = join(dir, 'logo.webp')
    await sharp(jpg).webp().toFile(webp)

    const resolved = await resolveInputs([jpg, webp], { recursive: false })
    const plan = await buildPlan({ resolved, target: 'png', options, force: false })

    expect(plan.jobs).toHaveLength(1)
    expect(plan.failures).toHaveLength(1)
    expect(plan.failures[0]?.error.code).toBe('output-collision')
    expect(plan.failures[0]?.error.detail).toContain('logo.jpg')
    expect(plan.failures[0]?.error.detail).toContain('logo.webp')
    expect(plan.failures[0]?.error.detail).toContain('logo.png')
  })

  it('still refuses the collision with force, since force means overwrite-on-disk, not fight-each-other', async () => {
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'logo.jpg')
    const webp = join(dir, 'logo.webp')
    await sharp(jpg).webp().toFile(webp)

    const resolved = await resolveInputs([jpg, webp], { recursive: false })
    const plan = await buildPlan({ resolved, target: 'png', options, force: true })

    expect(plan.jobs).toHaveLength(1)
    expect(plan.failures).toHaveLength(1)
    expect(plan.failures[0]?.error.code).toBe('output-collision')
  })

  it('produces two jobs for two sources that do not collide', async () => {
    const dir = await makeTempDir()
    const a = await makeJpeg(dir, 'a.jpg')
    const b = await makeJpeg(dir, 'b.jpg')
    const resolved = await resolveInputs([a, b], { recursive: false })
    const plan = await buildPlan({ resolved, target: 'png', options, force: false })
    expect(plan.jobs).toHaveLength(2)
    expect(plan.failures).toHaveLength(0)
  })

  it('carries input failures through untouched', async () => {
    const dir = await makeTempDir()
    const resolved = await resolveInputs([join(dir, 'ghost.jpg')], { recursive: false })
    const plan = await buildPlan({ resolved, target: 'webp', options, force: false })
    expect(plan.failures[0]?.error.code).toBe('file-not-found')
  })
})
