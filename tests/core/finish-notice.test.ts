import { describe, expect, it } from 'vitest'
import { finishNotice, NOTICE_AFTER_MS, noticeWorthy } from '../../src/core/finish-notice.js'

const made = (from: string | string[], to: string | string[]) => ({
  from: [from].flat(),
  to: [to].flat(),
})

describe('finishNotice', () => {
  it('names the file it made from the file it started with', () => {
    expect(
      finishNotice('Convert', { made: [made('/a/holiday.mov', '/b/holiday.mp4')], failed: [] }),
    ).toEqual({ title: 'Convert finished', body: 'holiday.mov → holiday.mp4' })
  })

  it('says where a batch went, by the folder’s own name', () => {
    const files = Array.from({ length: 12 }, (_, i) =>
      made(`/in/p${i}.heic`, `/Users/me/Desktop/p${i}.jpg`),
    )
    expect(finishNotice('Convert', { made: files, failed: [] })).toEqual({
      title: 'Convert finished 12 of 12 files',
      body: 'Saved to Desktop',
    })
  })

  it('names the folder the outputs share when a batch kept its subfolders', () => {
    const notice = finishNotice('Compress', {
      made: [made('/in/a.jpg', '/out/shots/a.jpg'), made('/in/x/b.jpg', '/out/shots/x/b.jpg')],
      failed: [],
    })
    expect(notice?.body).toBe('Saved to shots')
  })

  it('counts what was made against everything asked, and gives the first failure', () => {
    const files = Array.from({ length: 10 }, (_, i) => made(`/in/p${i}.heic`, `/out/p${i}.jpg`))
    expect(
      finishNotice('Convert', {
        made: files,
        failed: [
          { path: '/in/beach.heic', message: 'The file is damaged.' },
          { path: '/in/sea.heic', message: 'Something else.' },
        ],
      }),
    ).toEqual({
      title: 'Convert finished 10 of 12 files',
      body: 'beach.heic: The file is damaged.',
    })
  })

  it('says a one-file run failed, and why', () => {
    expect(
      finishNotice('Edit', {
        made: [],
        failed: [{ path: '/in/holiday.mov', message: 'ffmpeg stopped.' }],
      }),
    ).toEqual({ title: 'Edit failed', body: 'holiday.mov: ffmpeg stopped.' })
  })

  it('gives just the reason when the failure is not one file’s', () => {
    expect(finishNotice('PDF', { made: [], failed: [{ path: '', message: 'No room.' }] })).toEqual({
      title: 'PDF failed',
      body: 'No room.',
    })
  })

  it('counts the files of a run that made several from one, and of a merge', () => {
    expect(
      finishNotice('PDF', {
        made: [made('/a/book.pdf', ['/a/book-1.pdf', '/a/book-2.pdf', '/a/book-3.pdf'])],
        failed: [],
      })?.body,
    ).toBe('book.pdf → 3 files')
    expect(
      finishNotice('PDF', {
        made: [made(['/a/one.pdf', '/a/two.pdf'], '/a/one-merged.pdf')],
        failed: [],
      })?.body,
    ).toBe('2 files → one-merged.pdf')
  })

  it('has nothing to say about a run that did nothing', () => {
    expect(finishNotice('Convert', { made: [], failed: [] })).toBeUndefined()
  })
})

describe('noticeWorthy', () => {
  it('is 20 seconds: a run you sat through needs no notice', () => {
    expect(NOTICE_AFTER_MS).toBe(20_000)
    expect(noticeWorthy(19_999)).toBe(false)
    expect(noticeWorthy(20_000)).toBe(true)
  })
})
