import { describe, expect, it } from 'vitest'
import { lazy } from '../../src/engines/libs.js'

describe('lazy', () => {
  it('does not load until first asked', () => {
    let calls = 0
    lazy(async () => ++calls)
    expect(calls).toBe(0)
  })

  it('shares one load between concurrent first callers', async () => {
    let calls = 0
    const load = lazy(async () => {
      calls += 1
      await new Promise((r) => setTimeout(r, 10))
      return calls
    })
    const [a, b] = await Promise.all([load(), load()])
    expect(calls).toBe(1)
    expect(a).toBe(1)
    expect(b).toBe(1)
    expect(await load()).toBe(1)
  })
})
