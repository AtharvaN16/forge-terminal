import { describe, expect, it } from 'vitest'
import {
  extractOutputPaths,
  mergeOutputPath,
  splitOutputPaths,
  suffixedOutputPath,
} from '../../src/core/output-path.js'

describe('suffixedOutputPath', () => {
  it('appends a suffix before the extension', () => {
    expect(suffixedOutputPath('/docs/report.pdf', 'trimmed')).toBe('/docs/report-trimmed.pdf')
  })

  it('leaves the directory alone', () => {
    expect(suffixedOutputPath('/a/b/c/report.pdf', 'rotated')).toBe('/a/b/c/report-rotated.pdf')
  })
})

describe('splitOutputPaths', () => {
  it('numbers the outputs from 1', () => {
    expect(splitOutputPaths('/docs/report.pdf', 3)).toEqual([
      '/docs/report-1.pdf',
      '/docs/report-2.pdf',
      '/docs/report-3.pdf',
    ])
  })

  it('zero-pads so a file listing sorts correctly', () => {
    const paths = splitOutputPaths('/docs/report.pdf', 12)
    expect(paths[0]).toBe('/docs/report-01.pdf')
    expect(paths[11]).toBe('/docs/report-12.pdf')
  })

  it('pads to three digits past a hundred', () => {
    const paths = splitOutputPaths('/docs/report.pdf', 248)
    expect(paths[0]).toBe('/docs/report-001.pdf')
    expect(paths[247]).toBe('/docs/report-248.pdf')
  })
})

describe('extractOutputPaths', () => {
  it('produces one file when not separating', () => {
    expect(extractOutputPaths('/docs/report.pdf', [2, 3, 11], false)).toEqual([
      '/docs/report-extract.pdf',
    ])
  })

  it('names separate files by 1-based page number, not sequence', () => {
    expect(extractOutputPaths('/docs/report.pdf', [2, 3, 11], true)).toEqual([
      '/docs/report-p3.pdf',
      '/docs/report-p4.pdf',
      '/docs/report-p12.pdf',
    ])
  })
})

describe('mergeOutputPath', () => {
  it('names the output after the folder the inputs share', () => {
    expect(mergeOutputPath(['/home/me/invoices/jan.pdf', '/home/me/invoices/feb.pdf'])).toBe(
      '/home/me/invoices/invoices-merged.pdf',
    )
  })

  it('falls back to the first file when the inputs span folders', () => {
    expect(mergeOutputPath(['/home/me/a/jan.pdf', '/home/me/b/feb.pdf'])).toBe(
      '/home/me/a/jan-merged.pdf',
    )
  })

  it('handles a single input', () => {
    expect(mergeOutputPath(['/home/me/invoices/jan.pdf'])).toBe(
      '/home/me/invoices/invoices-merged.pdf',
    )
  })
})
