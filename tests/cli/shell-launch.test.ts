import { describe, expect, it } from 'vitest'
import { parseArgs } from '../../src/cli/args.js'
import { execute } from '../../src/cli/execute.js'

describe('shell intent', () => {
  it('bare forge still parses to the shell intent', () => {
    expect(parseArgs([])).toEqual({ kind: 'shell' })
  })

  it('execute no longer treats the shell as an error', async () => {
    const out = await execute({ kind: 'shell' })
    expect(out.exitCode).toBe(0)
    expect(out.stderr.join('\n')).not.toContain('not built yet')
  })

  it('flag invocations are untouched by the shell existing', async () => {
    const out = await execute(parseArgs(['--formats']))
    expect(out.exitCode).toBe(0)
    expect(out.stdout.join('\n')).toContain('HEIC')
  })
})
