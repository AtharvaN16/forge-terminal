import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { readPassword } from '../../src/cli/stdin.js'

describe('readPassword', () => {
  describe('stdin mode', () => {
    it('reads from stdin and returns the piped value', async () => {
      const input = 'hunter2\n'
      const stream = Readable.from([input])
      const original = process.stdin
      try {
        Object.defineProperty(process, 'stdin', { value: stream, configurable: true })
        const password = await readPassword({ stdin: true })
        expect(password).toBe('hunter2')
      } finally {
        Object.defineProperty(process, 'stdin', { value: original, configurable: true })
      }
    })

    it('strips a single trailing newline', async () => {
      const input = 'secret\n'
      const stream = Readable.from([input])
      const original = process.stdin
      try {
        Object.defineProperty(process, 'stdin', { value: stream, configurable: true })
        const password = await readPassword({ stdin: true })
        expect(password).toBe('secret')
      } finally {
        Object.defineProperty(process, 'stdin', { value: original, configurable: true })
      }
    })

    it('strips a carriage return and newline at the end', async () => {
      const input = 'secret\r\n'
      const stream = Readable.from([input])
      const original = process.stdin
      try {
        Object.defineProperty(process, 'stdin', { value: stream, configurable: true })
        const password = await readPassword({ stdin: true })
        expect(password).toBe('secret')
      } finally {
        Object.defineProperty(process, 'stdin', { value: original, configurable: true })
      }
    })

    it('preserves internal spaces and punctuation', async () => {
      const input = 'p@ss word! $$$\n'
      const stream = Readable.from([input])
      const original = process.stdin
      try {
        Object.defineProperty(process, 'stdin', { value: stream, configurable: true })
        const password = await readPassword({ stdin: true })
        expect(password).toBe('p@ss word! $$$')
      } finally {
        Object.defineProperty(process, 'stdin', { value: original, configurable: true })
      }
    })

    it('handles stdin with multiple chunks', async () => {
      const chunks = ['hunt', 'er', '2', '\n']
      const stream = Readable.from(chunks)
      const original = process.stdin
      try {
        Object.defineProperty(process, 'stdin', { value: stream, configurable: true })
        const password = await readPassword({ stdin: true })
        expect(password).toBe('hunter2')
      } finally {
        Object.defineProperty(process, 'stdin', { value: original, configurable: true })
      }
    })

    it('does not strip internal newlines, only trailing', async () => {
      const input = 'line1\nline2\n'
      const stream = Readable.from([input])
      const original = process.stdin
      try {
        Object.defineProperty(process, 'stdin', { value: stream, configurable: true })
        const password = await readPassword({ stdin: true })
        expect(password).toBe('line1\nline2')
      } finally {
        Object.defineProperty(process, 'stdin', { value: original, configurable: true })
      }
    })
  })
})
