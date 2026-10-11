import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { claimStdout } from '../../src/mcp/stdout-guard.js'

describe('claimStdout', () => {
  it('keeps the real stdout for the protocol and sends every other write to stderr', async () => {
    const out = new PassThrough()
    const err = new PassThrough()
    const outText: string[] = []
    const errText: string[] = []
    out.on('data', (d) => outText.push(String(d)))
    err.on('data', (d) => errText.push(String(d)))

    const protocol = claimStdout(
      out as unknown as NodeJS.WriteStream,
      err as unknown as NodeJS.WriteStream,
    )
    // What a stray console.log in a dependency does: write to process.stdout.
    out.write('stray\n')
    await new Promise<void>((resolve) => protocol.write('{"jsonrpc":"2.0"}\n', () => resolve()))

    expect(outText.join('')).toBe('{"jsonrpc":"2.0"}\n')
    expect(errText.join('')).toBe('stray\n')
  })
})
