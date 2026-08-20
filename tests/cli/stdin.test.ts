import { PassThrough, Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readPassword } from '../../src/cli/stdin.js'

describe('readPassword', () => {
  let originalStdin: NodeJS.ReadableStream
  let originalStderr: NodeJS.WritableStream

  beforeEach(() => {
    originalStdin = process.stdin
    originalStderr = process.stderr
  })

  afterEach(() => {
    Object.defineProperty(process, 'stdin', { value: originalStdin, configurable: true })
    Object.defineProperty(process, 'stderr', { value: originalStderr, configurable: true })
  })

  describe('stdin mode', () => {
    it('reads from stdin and returns the piped value', async () => {
      const input = 'hunter2\n'
      const stream = Readable.from([input])
      Object.defineProperty(process, 'stdin', { value: stream, configurable: true })
      const password = await readPassword({ stdin: true })
      expect(password).toBe('hunter2')
    })

    it('strips a single trailing newline', async () => {
      const input = 'secret\n'
      const stream = Readable.from([input])
      Object.defineProperty(process, 'stdin', { value: stream, configurable: true })
      const password = await readPassword({ stdin: true })
      expect(password).toBe('secret')
    })

    it('strips a carriage return and newline at the end', async () => {
      const input = 'secret\r\n'
      const stream = Readable.from([input])
      Object.defineProperty(process, 'stdin', { value: stream, configurable: true })
      const password = await readPassword({ stdin: true })
      expect(password).toBe('secret')
    })

    it('preserves internal spaces and punctuation', async () => {
      const input = 'p@ss word! $$$\n'
      const stream = Readable.from([input])
      Object.defineProperty(process, 'stdin', { value: stream, configurable: true })
      const password = await readPassword({ stdin: true })
      expect(password).toBe('p@ss word! $$$')
    })

    it('handles stdin with multiple chunks', async () => {
      const chunks = ['hunt', 'er', '2', '\n']
      const stream = Readable.from(chunks)
      Object.defineProperty(process, 'stdin', { value: stream, configurable: true })
      const password = await readPassword({ stdin: true })
      expect(password).toBe('hunter2')
    })

    it('does not strip internal newlines, only trailing', async () => {
      const input = 'line1\nline2\n'
      const stream = Readable.from([input])
      Object.defineProperty(process, 'stdin', { value: stream, configurable: true })
      const password = await readPassword({ stdin: true })
      expect(password).toBe('line1\nline2')
    })
  })

  describe('prompt mode', () => {
    // Note: These tests use Readable.from([...]) for stdin, which is never a TTY.
    // They verify the no-echo behavior and correct prompt handling with streams,
    // but do not cover the TTY-dependent path where terminal:true engages raw mode.
    // A regression that drops terminal:true would be invisible to these tests but
    // would cause the password to be echoed on real terminals. TTY-level verification
    // would require a pty harness (spawned subprocess with a real terminal); no such
    // harness exists in this repo. Masking was confirmed on a live pty once, by hand,
    // during review — that was a one-off check, not standing automated coverage.

    it('writes prompt and trailing newline to stderr', async () => {
      const inputStream = Readable.from(['mypassword\n'])
      const stderrWrites: string[] = []
      const mockStderr = new PassThrough()

      mockStderr.on('data', (chunk) => {
        stderrWrites.push(chunk.toString('utf8'))
      })

      Object.defineProperty(process, 'stdin', { value: inputStream, configurable: true })
      Object.defineProperty(process, 'stderr', { value: mockStderr, configurable: true })

      const password = await readPassword({ stdin: false })

      const allWritten = stderrWrites.join('')
      expect(allWritten).toBe('Password: \n')
      expect(password).toBe('mypassword')
    })

    it('does not echo typed characters to the output stream', async () => {
      const inputStream = Readable.from(['secret123\n'])
      const stderrWrites: string[] = []
      const mockStderr = new PassThrough()

      mockStderr.on('data', (chunk) => {
        stderrWrites.push(chunk.toString('utf8'))
      })

      Object.defineProperty(process, 'stdin', { value: inputStream, configurable: true })
      Object.defineProperty(process, 'stderr', { value: mockStderr, configurable: true })

      const password = await readPassword({ stdin: false })

      const allWritten = stderrWrites.join('')
      // Only the prompt and newline should be written; no echo of the typed password
      expect(allWritten).toBe('Password: \n')
      expect(allWritten).not.toContain('secret123')
      expect(password).toBe('secret123')
    })

    // Fixture note, learned the hard way over three review rounds: Readable.from([...])
    // ends as soon as its single chunk is consumed, and readline auto-closes on the
    // input's 'end' event. Under that fixture the explicit rl.close() in the finally
    // block is a no-op — deleting it changes nothing observable, so any teardown test
    // built on it is hollow. A teardown test needs a stream that stays open: a
    // PassThrough that is written to but never ended, as below.
    it('releases stdin when the prompt completes', async () => {
      // Never ended, so readline's own auto-close on input 'end' cannot fire. The only
      // thing that can release stdin here is the explicit rl.close() in the finally block.
      const inputStream = new PassThrough()
      const mockStderr = new PassThrough()
      mockStderr.resume()

      Object.defineProperty(process, 'stdin', { value: inputStream, configurable: true })
      Object.defineProperty(process, 'stderr', { value: mockStderr, configurable: true })

      const pending = readPassword({ stdin: false })
      inputStream.write('secret123\n')
      const password = await pending

      expect(password).toBe('secret123')
      // readline with terminal:true attaches a 'keypress' listener to stdin and removes
      // it when the interface closes. A surviving listener means the interface still
      // holds stdin. Asserted rather than isPaused() because the listener is the thing
      // that actually keeps stdin captured; pausing is a downstream side effect.
      expect(inputStream.listenerCount('keypress')).toBe(0)
    })
  })
})
