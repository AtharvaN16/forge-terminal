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
    it('writes prompt to stderr', async () => {
      const inputStream = Readable.from(['mypassword\n'])
      const stderrWrites: string[] = []
      const mockStderr = new PassThrough()

      mockStderr.on('data', (chunk) => {
        stderrWrites.push(chunk.toString('utf8'))
      })

      Object.defineProperty(process, 'stdin', { value: inputStream, configurable: true })
      Object.defineProperty(process, 'stderr', { value: mockStderr, configurable: true })

      const password = await readPassword({ stdin: false })

      expect(stderrWrites).toContain('Password: ')
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
      // Only the prompt should be written; no echo of the typed password
      expect(allWritten).toBe('Password: ')
      expect(allWritten).not.toContain('secret123')
      expect(password).toBe('secret123')
    })
  })
})
