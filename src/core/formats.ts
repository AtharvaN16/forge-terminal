import type { FormatId, FormatSpec } from './types.js'

export const FORMATS: Record<FormatId, FormatSpec> = {
  jpeg: {
    id: 'jpeg',
    label: 'JPEG',
    extensions: ['.jpg', '.jpeg'],
    hasAlpha: false,
    animatable: false,
    lossy: true,
    hint: 'universal',
    defaultQuality: 82,
  },
  png: {
    id: 'png',
    label: 'PNG',
    extensions: ['.png'],
    hasAlpha: true,
    animatable: false,
    lossy: false,
    hint: 'lossless',
  },
  webp: {
    id: 'webp',
    label: 'WebP',
    extensions: ['.webp'],
    hasAlpha: true,
    animatable: true,
    lossy: true,
    hint: 'smaller, modern',
    defaultQuality: 80,
  },
  avif: {
    id: 'avif',
    label: 'AVIF',
    extensions: ['.avif'],
    hasAlpha: true,
    animatable: true,
    lossy: true,
    hint: 'smallest',
    defaultQuality: 50,
  },
  heic: {
    id: 'heic',
    label: 'HEIC',
    extensions: ['.heic', '.heif'],
    hasAlpha: true,
    animatable: false,
    lossy: true,
    hint: 'Apple photos',
  },
  gif: {
    id: 'gif',
    label: 'GIF',
    extensions: ['.gif'],
    hasAlpha: true,
    animatable: true,
    lossy: false,
    hint: 'animation',
  },
  tiff: {
    id: 'tiff',
    label: 'TIFF',
    extensions: ['.tif', '.tiff'],
    hasAlpha: true,
    animatable: false,
    lossy: false,
    hint: 'archival',
  },
  pdf: {
    id: 'pdf',
    label: 'PDF',
    extensions: ['.pdf'],
    hasAlpha: false,
    animatable: false,
    // A PDF container is not lossy. /compress supplies its own quality
    // control; /convert must not show a quality slider for this target.
    lossy: false,
    hint: 'document',
  },
  docx: {
    id: 'docx',
    label: 'DOCX',
    extensions: ['.docx'],
    hasAlpha: false,
    animatable: false,
    lossy: false,
    hint: 'Word document',
  },
  doc: {
    id: 'doc',
    label: 'DOC',
    extensions: ['.doc'],
    hasAlpha: false,
    animatable: false,
    lossy: false,
    hint: 'legacy Word',
  },
}

export const ALL_FORMAT_IDS = Object.keys(FORMATS) as FormatId[]

export function formatById(id: string): FormatSpec | undefined {
  return (FORMATS as Record<string, FormatSpec | undefined>)[id.toLowerCase()]
}

export function primaryExtension(id: FormatId): string {
  const ext = FORMATS[id].extensions[0]
  if (!ext) throw new Error(`format ${id} declares no extensions`)
  return ext
}
