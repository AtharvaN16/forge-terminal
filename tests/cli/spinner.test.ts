import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { startSpinner } from '../../src/cli/spinner.js'

/** A writable that records everything, standing in for stderr. */
function capture(isTTY: boolean) {
  const stream = new PassThrough() as PassThrough & { isTTY?: boolean }
  stream.isTTY = isTTY
  const chunks: string[] = []
  stream.on('data', (c: Buffer) => chunks.push(c.toString()))
  return { stream, written: () => chunks.join('') }
}

describe('the search spinner', () => {
  it('writes nothing at all when the stream is not a terminal', () => {
    // A piped or CI run must stay clean: spinner frames in captured output
    // would corrupt whatever is reading it.
    const { stream, written } = capture(false)
    const spinner = startSpinner(stream, 'searching')
    spinner.update('150 dpi · attempt 1 of 8')
    spinner.tick()
    spinner.stop()
    expect(written()).toBe('')
  })

  it('shows the real position it was given, not an invented one', () => {
    // Invariant 7. The spinner supplies motion; every number in it comes
    // from the search's own bounded sequence.
    const { stream, written } = capture(true)
    const spinner = startSpinner(stream, 'searching')
    spinner.update('150 dpi · attempt 3 of 8')
    spinner.stop()
    expect(written()).toContain('attempt 3 of 8')
    expect(written()).toContain('searching')
  })

  it('advances the frame on each tick, so it reads as alive', () => {
    const { stream, written } = capture(true)
    const spinner = startSpinner(stream, 'searching')
    spinner.update('working')
    const first = written()
    spinner.tick()
    const second = written().slice(first.length)
    // Different frame glyph on the second write.
    expect(second).not.toBe('')
    expect(second).not.toBe(first)
  })

  it('redraws in place rather than scrolling a new line each time', () => {
    const { stream, written } = capture(true)
    const spinner = startSpinner(stream, 'searching')
    spinner.update('one')
    spinner.update('two')
    spinner.stop()
    // A carriage return returns the cursor; a newline would leave a trail.
    expect(written()).toContain('\r')
    expect(written().split('\n').length).toBeLessThan(3)
  })

  it('clears its line on stop, leaving nothing behind for the result', () => {
    // The result line is written after this. A leftover spinner frame would
    // sit in front of it.
    const { stream, written } = capture(true)
    const spinner = startSpinner(stream, 'searching')
    spinner.update('150 dpi · attempt 8 of 8')
    spinner.stop()
    const tail = written().slice(written().lastIndexOf('\r'))
    expect(tail).not.toContain('attempt')
  })

  it('survives stop being called twice', () => {
    const { stream } = capture(true)
    const spinner = startSpinner(stream, 'searching')
    spinner.update('x')
    spinner.stop()
    expect(() => spinner.stop()).not.toThrow()
  })
})
