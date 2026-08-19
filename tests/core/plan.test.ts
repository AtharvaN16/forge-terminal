import { join } from 'node:path'
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
    expect(plan.jobs[0]?.output).toBe(join(dir, 'a.webp'))
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

  it('carries input failures through untouched', async () => {
    const dir = await makeTempDir()
    const resolved = await resolveInputs([join(dir, 'ghost.jpg')], { recursive: false })
    const plan = await buildPlan({ resolved, target: 'webp', options, force: false })
    expect(plan.failures[0]?.error.code).toBe('file-not-found')
  })
})
