import { availableParallelism } from 'node:os'
import { describe, expect, it } from 'vitest'
import { defaultConcurrency } from '../../src/core/run.js'
import { sizeThreadpool, workerCount } from '../../src/core/threads.js'

describe('workerCount', () => {
  it('is one per core, and never more than eight', () => {
    expect(workerCount()).toBe(Math.max(1, Math.min(availableParallelism(), 8)))
  })
})

describe('sizeThreadpool', () => {
  it('gives libuv a thread for every worker', () => {
    const env: NodeJS.ProcessEnv = {}
    sizeThreadpool(env)
    expect(env.UV_THREADPOOL_SIZE).toBe(String(workerCount()))
  })

  it('leaves a size someone set alone', () => {
    const env: NodeJS.ProcessEnv = { UV_THREADPOOL_SIZE: '2' }
    sizeThreadpool(env)
    expect(env.UV_THREADPOOL_SIZE).toBe('2')
  })
})

describe('defaultConcurrency', () => {
  it('is the worker count', () => {
    expect(defaultConcurrency({})).toBe(workerCount())
  })

  it('never runs more jobs than libuv has threads for', () => {
    expect(defaultConcurrency({ UV_THREADPOOL_SIZE: '2' })).toBe(Math.min(2, workerCount()))
  })
})
