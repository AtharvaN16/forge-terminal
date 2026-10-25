import { describe, expect, it } from 'vitest'
import { finishNotice } from '../../src/core/finish-notice.js'

const made = (from: string, to: string) => ({ from: [from], to: [to] })

describe('a long run’s notice on Windows', () => {
  it('names the folder the outputs share, whichever slash the paths use, on any machine', () => {
    for (const [a, b] of [
      ['C:\\out\\shots\\a.jpg', 'C:\\out\\shots\\x\\b.jpg'],
      ['C:/out/shots/a.jpg', 'C:/out/shots/x/b.jpg'],
      ['C:\\out\\shots\\a.jpg', 'C:/out/shots/x/b.jpg'],
    ] as const) {
      const notice = finishNotice(
        'Compress',
        {
          made: [made('C:\\in\\a.jpg', a), made('C:\\in\\x\\b.jpg', b)],
          failed: [],
        },
        'win32',
      )
      expect(notice?.body).toBe('Saved to shots')
    }
  })
})
