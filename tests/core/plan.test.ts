import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildPlan } from '../../src/core/plan.js'
import { resolveInputs } from '../../src/core/resolve.js'
import type { ConvertOptions } from '../../src/core/types.js'
import { makeJpeg, makeTempDir } from '../helpers/fixtures.js'

const options: ConvertOptions = { background: '#ffffff', keepMetadata: false }

/**
 * Planning only. Write safety moved to `runPlan`, which applies it to every
 * job whatever planned it — see `tests/core/execute-jobs.test.ts`.
 */
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
