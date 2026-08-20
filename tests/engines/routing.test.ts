import { describe, expect, it } from 'vitest'
import type { DocumentInfo, ImageInfo, Job } from '../../src/core/types.js'
import { engineForJob } from '../../src/engines/registry.js'

const doc: DocumentInfo = {
  kind: 'document',
  path: '/tmp/a.pdf',
  format: 'pdf',
  bytes: 1,
  pages: 3,
  encrypted: false,
}
const png: ImageInfo = {
  kind: 'image',
  path: '/tmp/a.png',
  format: 'png',
  bytes: 1,
  width: 1,
  height: 1,
  hasAlpha: false,
  frames: 1,
}
const options = { background: '#ffffff', keepMetadata: false }

describe('engineForJob routes a conversion by both ends', () => {
  it('sends an image to the image engine', () => {
    const job: Job = {
      op: 'convert',
      sources: [png],
      outputs: ['/tmp/a.jpg'],
      target: 'jpeg',
      options,
    }
    expect(engineForJob(job)?.id).toBe('image')
  })

  it('sends a document to the engine that can read one', () => {
    const job: Job = {
      op: 'convert',
      sources: [doc],
      outputs: ['/tmp/a.jpg'],
      target: 'jpeg',
      options,
    }
    // The image engine also writes jpeg. Matching on target alone picks it,
    // and it cannot read a PDF — this is the regression under test.
    // Named, not `.not.toBe('image')`: that also passes when no engine is
    // found at all, so deleting pdfium from the registry would leave it green.
    expect(engineForJob(job)?.id).toBe('pdfium')
  })

  it('finds no engine for a pairing nothing supports', () => {
    const job: Job = {
      op: 'convert',
      sources: [doc],
      outputs: ['/tmp/a.gif'],
      target: 'gif',
      options,
    }
    expect(engineForJob(job)).toBeUndefined()
  })
})
