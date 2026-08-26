import { describe, expect, it } from 'vitest'
import { describeResult } from '../../src/core/describe.js'
import type { DocumentInfo, FormatId, ImageInfo, Job, Result } from '../../src/core/types.js'

const image = (path: string, format: FormatId, bytes: number): ImageInfo => ({
  kind: 'image',
  path,
  format,
  bytes,
  width: 100,
  height: 100,
  hasAlpha: false,
  frames: 1,
})

const document = (path: string, bytes: number, pages: number): DocumentInfo => ({
  kind: 'document',
  path,
  format: 'pdf',
  bytes,
  pages,
  encrypted: false,
})

const convertJob = (
  source: ImageInfo | DocumentInfo,
  target: FormatId,
  outputs: [string, ...string[]],
): Job => ({
  op: 'convert',
  sources: [source],
  outputs,
  target,
  options: { background: '#ffffff', keepMetadata: false },
})

describe('describeResult', () => {
  it('calls a format change a conversion', () => {
    const result: Result = {
      job: convertJob(image('/in.jpg', 'jpeg', 1000), 'webp', ['/out.webp']),
      outputBytes: 400,
      warnings: [],
    }

    const view = describeResult(result)

    expect(view.verb).toBe('converted')
    expect(view.size).toEqual({ from: 1000, to: 400 })
  })

  /**
   * `compressAction.plan()` emits `op: 'convert'` jobs, so the op alone cannot
   * tell compress from convert. Same format in and out is what distinguishes
   * them.
   */
  it('calls a same-format re-encode a compression', () => {
    const result: Result = {
      job: convertJob(image('/in.jpg', 'jpeg', 1000), 'jpeg', ['/in-compressed.jpg']),
      outputBytes: 400,
      warnings: [],
    }

    expect(describeResult(result).verb).toBe('compressed')
  })

  /**
   * The bug this replaces: the shell reported `✓ done — doc-01.jpg` for a
   * twenty-page render, naming one file of twenty.
   */
  it('reports every output of a multi-page render, not just the first', () => {
    const outputs = Array.from({ length: 20 }, (_, i) => `/doc-${i + 1}.jpg`) as [
      string,
      ...string[],
    ]
    const result: Result = {
      job: convertJob(document('/doc.pdf', 5000, 20), 'jpeg', outputs),
      outputBytes: 900,
      warnings: [],
    }

    const view = describeResult(result)

    expect(view.outputs).toHaveLength(20)
    expect(view.outputs[19]).toBe('/doc-20.jpg')
  })

  it('omits the size delta when one source became many outputs', () => {
    const outputs = ['/doc-1.jpg', '/doc-2.jpg'] as [string, ...string[]]
    const result: Result = {
      job: convertJob(document('/doc.pdf', 5000, 2), 'jpeg', outputs),
      outputBytes: 900,
      warnings: [],
    }

    expect(describeResult(result).size).toBeUndefined()
  })

  /**
   * The shell dropped these entirely: `runPdfJobs` never read `result.warnings`,
   * so `pdf-downsampled` reached CLI users and not shell users.
   */
  it('carries warnings through', () => {
    const warnings = [
      {
        code: 'pdf-downsampled' as const,
        message: 'Images reduced from 300 to 150 dpi. Pass --dpi 300 to keep them.',
      },
    ]
    const result: Result = {
      job: convertJob(document('/scan.pdf', 5000, 1), 'pdf', ['/scan-compressed.pdf']),
      outputBytes: 900,
      warnings,
    }

    expect(describeResult(result).warnings).toEqual(warnings)
  })

  it('names each page operation', () => {
    const merge: Job = {
      op: 'merge',
      sources: [document('/a.pdf', 100, 1), document('/b.pdf', 100, 1)],
      outputs: ['/merged.pdf'],
    }

    expect(describeResult({ job: merge, outputBytes: 200, warnings: [] }).verb).toBe('merged')
  })
})
