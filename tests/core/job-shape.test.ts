import { describe, expect, it } from 'vitest'
import type { DocumentInfo, ImageInfo, Job } from '../../src/core/types.js'
import { engineForJob } from '../../src/engines/registry.js'

const image: ImageInfo = {
  kind: 'image',
  path: '/tmp/a.jpg',
  format: 'jpeg',
  bytes: 1,
  width: 1,
  height: 1,
  hasAlpha: false,
  frames: 1,
}
const doc: DocumentInfo = {
  kind: 'document',
  path: '/tmp/a.pdf',
  format: 'pdf',
  bytes: 1,
  pages: 7,
  encrypted: false,
}

describe('Job', () => {
  it('routes a convert job to the image engine', () => {
    const job: Job = {
      op: 'convert',
      sources: [image],
      outputs: ['/tmp/a.webp'],
      target: 'webp',
      options: { background: '#ffffff', keepMetadata: false },
    }
    expect(engineForJob(job)?.id).toBe('image')
  })

  it('routes a merge job to the pdf engine', () => {
    const job: Job = { op: 'merge', sources: [doc, doc], outputs: ['/tmp/out.pdf'] }
    expect(engineForJob(job)?.id).toBe('pdf')
  })

  it('routes a split job to the pdf engine', () => {
    const job: Job = {
      op: 'split',
      sources: [doc],
      outputs: ['/tmp/1.pdf', '/tmp/2.pdf'],
      cuts: [2],
    }
    expect(engineForJob(job)?.id).toBe('pdf')
  })
})
