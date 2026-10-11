import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { asForgeError, fatalLines } from '../../src/cli/fatal.js'
import { fileNotFound } from '../../src/core/errors.js'

const tsx = join(process.cwd(), 'node_modules', '.bin', 'tsx')

function runChild(script: string): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    execFile(tsx, [script], (err, _stdout, stderr) => {
      const code = err ? ((err as { code?: number }).code ?? -1) : 0
      resolve({ code, stderr })
    })
  })
}

describe('guardUnsettled', () => {
  it('turns an await that can never settle into a Forge error and exit 1, not Node exit 13', async () => {
    const { code, stderr } = await runChild(
      join(process.cwd(), 'tests', 'helpers', 'unsettled-child.ts'),
    )
    expect(code).toBe(1)
    expect(stderr).toContain('Something went wrong')
    expect(stderr).not.toContain('unsettled top-level await')
  })
})

describe('fatalLines', () => {
  it('wraps a non-Forge error without a stack trace', () => {
    const text = fatalLines(new Error('boom'), false).join('\n')
    expect(text).toContain('Something went wrong')
    expect(text).toContain('boom')
    expect(text).not.toMatch(/\n\s+at /)
  })

  it('renders a ForgeError as itself', () => {
    expect(fatalLines(fileNotFound('/a/x.jpg'), false)[0]).toBe('✕ File not found')
  })

  it('asForgeError passes a ForgeError through untouched', () => {
    const e = fileNotFound('/a/x.jpg')
    expect(asForgeError(e)).toBe(e)
    expect(asForgeError('oops').code).toBe('unexpected')
  })
})
