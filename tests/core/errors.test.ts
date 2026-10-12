import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  conversionFailed,
  corruptFormatSource,
  corruptSource,
  emptyDirectory,
  encryptedSource,
  ForgeError,
  fileNotFound,
  heicDecoderUnavailable,
  isForgeError,
  notADirectory,
  notAFile,
  outputCollision,
  outputExists,
  outputIsInput,
  pathTooLong,
  permissionDenied,
  renderError,
  selfCollision,
  symlinkLoop,
  targetUnreachable,
  unreadablePath,
  unsupportedCompress,
  unsupportedSource,
  unsupportedTarget,
  type WarningCode,
} from '../../src/core/errors.js'
import type { SourceInfo, Warning } from '../../src/core/types.js'

const source: SourceInfo = {
  kind: 'image',
  path: '/tmp/photo.jpg',
  format: 'jpeg',
  width: 10,
  height: 10,
  bytes: 100,
  hasAlpha: false,
  frames: 1,
}

describe('ForgeError', () => {
  it('carries a code, a title, a detail and a hint', () => {
    const e = fileNotFound('photo.jpg')
    expect(e).toBeInstanceOf(ForgeError)
    expect(e.code).toBe('file-not-found')
    expect(e.title).toBe('File not found')
    expect(e.detail).toContain('photo.jpg')
    expect(e.hint).toBeTruthy()
  })

  it('is recognisable by a type guard', () => {
    expect(isForgeError(fileNotFound('a.jpg'))).toBe(true)
    expect(isForgeError(new Error('plain'))).toBe(false)
  })

  it('lists the available targets when the requested one is impossible', () => {
    const e = unsupportedTarget(source, 'mp4', ['webp', 'png', 'avif'])
    expect(e.code).toBe('unsupported-target')
    expect(e.detail).toContain('JPEG')
    expect(e.hint).toContain('webp, png, avif')
  })

  it('names the offending file for every file-scoped error', () => {
    expect(permissionDenied('/tmp/x.png').detail).toContain('x.png')
    expect(corruptSource('/tmp/x.png', new Error('boom')).detail).toContain('x.png')
    expect(outputExists('/tmp/out.webp').detail).toContain('out.webp')
  })

  it('suggests --force when the output already exists', () => {
    expect(outputExists('/tmp/out.webp').hint).toContain('--force')
  })

  it('distinguishes one job writing a path twice from two sources colliding', () => {
    const self = selfCollision('/tmp/source.pdf', '/tmp/out.pdf')
    const between = outputCollision(['/tmp/a.jpg', '/tmp/b.png'], '/tmp/out.webp')
    expect(self.code).toBe(between.code)
    expect(self.title).not.toBe(between.title)
    expect(self.detail).toContain('twice')
    expect(self.hint).not.toContain('--force')
  })
})

describe('renderError', () => {
  it('renders a symbol, a title, the detail and the hint', () => {
    const lines = renderError(fileNotFound('photo.jpg')).join('\n')
    expect(lines).toContain('✕ File not found')
    expect(lines).toContain('photo.jpg')
    expect(lines).toContain('Check the filename')
  })

  it('hides the underlying cause by default', () => {
    const e = conversionFailed('/tmp/x.png', new Error('vips exploded'))
    expect(renderError(e).join('\n')).not.toContain('vips exploded')
  })

  it('reveals the underlying cause under debug', () => {
    const e = conversionFailed('/tmp/x.png', new Error('vips exploded'))
    expect(renderError(e, { debug: true }).join('\n')).toContain('vips exploded')
  })
})

describe('refusing to compress', () => {
  const png = {
    kind: 'image' as const,
    path: '/tmp/logo.png',
    format: 'png' as const,
    width: 10,
    height: 10,
    bytes: 100,
    hasAlpha: false,
    frames: 1,
  }
  const pdf = {
    kind: 'document' as const,
    path: '/tmp/brochure.pdf',
    format: 'pdf' as const,
    bytes: 1_400_000,
    pages: 7,
    encrypted: false,
  }

  it('tells a lossless image the truth: there is no quality to trade', () => {
    const e = unsupportedCompress(png)
    expect(e.detail).toContain('lossless')
    expect(e.detail).toContain('logo.png')
  })

  it('does NOT claim a PDF is lossless', () => {
    // A PDF is a container. Its pages are usually JPEGs, which compress
    // fine — measured at 79% smaller. Saying "lossless, no quality to
    // trade away" is true of PNG and false of PDF, and it sent a user
    // looking for a workaround that does not exist.
    const e = unsupportedCompress(pdf)
    expect(e.detail).not.toContain('lossless')
    expect(e.detail).toContain('brochure.pdf')
  })

  it('points a PDF at what does work, not at a smaller format', () => {
    // In the shell, where `/pdf` is something you can actually type.
    const e = unsupportedCompress(pdf)
    expect(e.shellHint).toContain('/pdf')
  })

  const jpeg = { ...png, path: '/tmp/photo.jpg', format: 'jpeg' as const }

  it('names a lossless target, not the source, when the size applies to a conversion', () => {
    const e = unsupportedCompress(jpeg, 'png')
    expect(e.code).toBe('unsupported-compress')
    expect(e.detail).toContain('PNG is lossless')
    expect(e.detail).toContain('photo.jpg')
    expect(e.detail).not.toContain('JPEG')
  })

  it('says a lossy target cannot be searched yet, rather than calling it lossless', () => {
    const e = unsupportedCompress(pdf, 'jpeg')
    expect(e.detail).not.toContain('lossless')
    expect(e.detail).toContain('brochure.pdf')
    expect(e.detail).toContain('JPEG')
  })

  it('keeps the old wording when the target is the source format', () => {
    expect(unsupportedCompress(png, 'png').detail).toBe(unsupportedCompress(png).detail)
  })
})

/**
 * A slash command only exists inside the shell. The same constructors feed
 * the CLI's `renderError`, which printed "Try a larger target, or /convert to
 * a smaller format" to someone at a bash prompt with no `/convert` to type.
 * Each surface gets its own phrasing: `hint` for the CLI, `shellHint` for the
 * shell's history block.
 */
describe('hints speak the surface that shows them', () => {
  const slashCommand = /(^|\s)\/(convert|pdf|compress)\b/
  const lossless: SourceInfo = { ...source, path: '/tmp/logo.png', format: 'png' }
  const pdf: SourceInfo = {
    kind: 'document',
    path: '/tmp/brochure.pdf',
    format: 'pdf',
    bytes: 1_400_000,
    pages: 7,
    encrypted: false,
  }
  const docx: SourceInfo = {
    kind: 'document',
    path: '/tmp/report.docx',
    format: 'docx',
    bytes: 40_000,
    pages: 2,
    encrypted: false,
  }
  const cases = [
    ['a lossless image', unsupportedCompress(lossless)],
    ['a PDF with nothing to compress', unsupportedCompress(pdf)],
    ['a Word document', unsupportedCompress(docx)],
    ['an unreachable size', targetUnreachable(source, 1_000, 11_600)],
  ] as const

  for (const [name, e] of cases) {
    it(`never tells the CLI to type a slash command — ${name}`, () => {
      expect(e.hint).toBeTruthy()
      expect(e.hint).not.toMatch(slashCommand)
      expect(renderError(e).join('\n')).not.toMatch(slashCommand)
    })

    it(`keeps the shell's slash-command phrasing — ${name}`, () => {
      expect(e.shellHint).toMatch(slashCommand)
    })
  }

  it('names the CLI flags that do the same job instead', () => {
    expect(targetUnreachable(source, 1_000, 11_600).hint).toContain('--max-size')
    expect(unsupportedCompress(lossless).hint).toContain('--to')
    expect(unsupportedCompress(docx).hint).toContain('--to')
  })
})

/**
 * The write-safety and empty-folder refusals give CLI advice — `--force`,
 * `--output`, `--recursive` — and the shell rendered it verbatim, though the
 * shell has none of those flags. Each gets shell phrasing that names only
 * what the shell actually offers: it asks before replacing a file (Replace /
 * Keep both), sends a conversion that would overwrite its input back to the
 * folder picker, and takes dropped files rather than folders.
 */
describe('write-safety hints in the shell name no CLI flags', () => {
  const flag = /--[a-z]/
  const cases = [
    ['a file that already exists (convert)', outputExists('/tmp/photo.webp')],
    ['a file that already exists (page operation)', outputExists('/tmp/doc-1.pdf', 'split')],
    [
      'two files wanting one output',
      outputCollision(['/tmp/a/x.png', '/tmp/b/x.png'], '/tmp/x.webp'),
    ],
    ['an output that is its own input (convert)', outputIsInput('/tmp/photo.jpg')],
    ['an output that is its own input (page operation)', outputIsInput('/tmp/doc.pdf', 'rotate')],
    ['an empty folder', emptyDirectory('/tmp/empty')],
  ] as const

  for (const [name, e] of cases) {
    it(`gives the shell its own advice — ${name}`, () => {
      expect(e.shellHint).toBeTruthy()
      expect(e.shellHint).not.toMatch(flag)
    })

    it(`keeps the CLI's flag advice — ${name}`, () => {
      expect(e.hint).toMatch(flag)
    })
  }

  it('tells the shell user it will be asked, since the shell offers Replace itself', () => {
    expect(outputExists('/tmp/photo.webp').shellHint).toMatch(/ask/i)
  })

  it('sends a conversion onto its own input to a different folder', () => {
    expect(outputIsInput('/tmp/photo.jpg').shellHint).toMatch(/folder/i)
  })
})

describe('WarningCode', () => {
  it('is the type of every Warning code', () => {
    expectTypeOf<Warning['code']>().toEqualTypeOf<WarningCode>()
  })
})

describe('unsupportedCompress for a PDF', () => {
  const pdf = (images: { compressible: number; skipped: number }): SourceInfo => ({
    kind: 'document',
    path: '/tmp/notes.pdf',
    format: 'pdf',
    bytes: 1000,
    pages: 2,
    encrypted: false,
    images,
  })

  it('says a text-only PDF has nothing to compress, not that Forge cannot yet', () => {
    const e = unsupportedCompress(pdf({ compressible: 0, skipped: 0 }))
    expect(e.title).toBe('Nothing to compress')
    expect(e.detail).toContain('no images')
    expect(`${e.title} ${e.detail} ${e.hint}`).not.toMatch(/\byet\b/)
  })

  it('says when the images are a kind Forge cannot re-encode', () => {
    expect(unsupportedCompress(pdf({ compressible: 0, skipped: 3 })).detail).toContain(
      'cannot re-encode',
    )
  })
})

describe('short', () => {
  const cases = [
    ['file-not-found', fileNotFound('/tmp/a.png'), 'a.png could not be found.'],
    ['not-a-file', notAFile('/tmp/a.png'), 'a.png is not a file.'],
    ['permission-denied', permissionDenied('/tmp/a.png'), 'a.png could not be read.'],
    ['not-a-directory', notADirectory('/tmp/a.png'), "part of a.png's path is not a folder."],
    ['symlink-loop', symlinkLoop('/tmp/a.png'), "a.png's path loops back on itself."],
    ['path-too-long', pathTooLong('/tmp/a.png'), "a.png's path is too long."],
    [
      'unreadable-path',
      unreadablePath('/tmp/a.png', new Error('x')),
      'a.png could not be checked.',
    ],
    [
      'unsupported-source',
      unsupportedSource('/tmp/a.mp3', 'an audio file'),
      'a.mp3 is an audio file, which Forge cannot read.',
    ],
    ['corrupt-source', corruptSource('/tmp/a.png', new Error('x')), 'a.png could not be read.'],
    [
      'corrupt-source (named format)',
      corruptFormatSource('/tmp/a.png', 'png', new Error('x')),
      'a.png could not be read.',
    ],
    ['encrypted-source', encryptedSource('/tmp/a.pdf'), 'a.pdf is password-protected.'],
    [
      'heic-decoder-unavailable',
      heicDecoderUnavailable('/tmp/a.heic'),
      'HEIC needs sips, which could not be run.',
    ],
  ] as const

  for (const [name, e, short] of cases) {
    it(`gives the shell a one-line reason — ${name}`, () => {
      expect(e.short).toBe(short)
    })
  }

  it('leaves short absent when the detail already reads as one line', () => {
    expect(conversionFailed('/tmp/a.png', new Error('x')).short).toBeUndefined()
  })
})
