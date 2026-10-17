import { describe, expect, it } from 'vitest'
import { sniffMedia } from '../../src/engines/media-sniff.js'

const ascii = (s: string) => Buffer.from(s, 'latin1')
const box = (brand: string) =>
  Buffer.concat([Buffer.from([0, 0, 0, 0x18]), ascii(`ftyp${brand}`), Buffer.alloc(12)])

describe('sniffMedia', () => {
  it.each([
    ['qt  ', 'mov'],
    ['isom', 'mp4'],
    ['mp42', 'mp4'],
    ['avc1', 'mp4'],
    ['M4V ', 'mp4'],
    ['M4A ', 'm4a'],
    ['M4B ', 'm4a'],
    ['3gp4', 'mp4'],
  ])('reads an ftyp box branded %s as %s', (brand, format) => {
    expect(sniffMedia(box(brand))).toBe(format)
  })

  it('does not take a HEIC (also an ftyp box) for a video', () => {
    expect(sniffMedia(box('heic'))).toBeUndefined()
    expect(sniffMedia(box('mif1'))).toBeUndefined()
    expect(sniffMedia(box('avif'))).toBeUndefined()
  })

  it('reads WebM and Matroska from the EBML doctype', () => {
    const ebml = (doctype: string) =>
      Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x82, 0x84]), ascii(doctype)])
    expect(sniffMedia(ebml('webm'))).toBe('webm')
    expect(sniffMedia(ebml('matroska'))).toBe('mkv')
  })

  it.each([
    [Buffer.concat([ascii('RIFF'), Buffer.alloc(4), ascii('WAVEfmt ')]), 'wav'],
    [Buffer.concat([ascii('RIFF'), Buffer.alloc(4), ascii('AVI LIST')]), 'avi'],
    [Buffer.concat([ascii('FORM'), Buffer.alloc(4), ascii('AIFF')]), 'aiff'],
    [Buffer.concat([ascii('FORM'), Buffer.alloc(4), ascii('AIFC')]), 'aiff'],
    [ascii('fLaC\0\0\0\x22'), 'flac'],
    [ascii('ID3\x04\0\0\0\0\0\0'), 'mp3'],
    [Buffer.from([0xff, 0xfb, 0x90, 0x64, 0, 0]), 'mp3'],
  ])('reads %#', (head, format) => {
    expect(sniffMedia(head)).toBe(format)
  })

  it('tells Opus from Vorbis in an Ogg file', () => {
    const ogg = (codec: string) => Buffer.concat([ascii('OggS'), Buffer.alloc(24), ascii(codec)])
    expect(sniffMedia(ogg('OpusHead'))).toBe('opus')
    expect(sniffMedia(ogg('\x01vorbis'))).toBe('ogg')
  })

  it('declines anything else', () => {
    expect(sniffMedia(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBeUndefined()
    expect(sniffMedia(ascii('%PDF-1.7'))).toBeUndefined()
    expect(sniffMedia(Buffer.alloc(0))).toBeUndefined()
  })
})
