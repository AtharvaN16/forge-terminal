import { describe, expect, it } from 'vitest'
import type { Row } from '../../src/shell/home-art.js'
import { ownSheetRows } from '../../src/shell/own-art.js'
import { DARK } from '../../src/shell/theme.js'

const text = (rows: Row[]) => rows.map((r) => r.map((run) => run.text).join(''))

describe('ownSheetRows', () => {
  it('reads header, card, then the one other thing, the pill at the header’s far end', () => {
    const rows = ownSheetRows(
      DARK,
      {
        name: 'YouTube links',
        gives: 'Transcribe YouTube videos',
        action: '↵ install',
        tag: 'yt-dlp',
        facts: [
          ['Status', [{ text: 'Not installed' }]],
          ['Size', [{ text: '37.1 MB download' }]],
        ],
        under: [{ text: 'Already have yt-dlp?' }],
      },
      50,
    )
    expect(text(rows)).toEqual([
      `${'YouTube links'.padEnd(39)} ↵ install `,
      'Transcribe YouTube videos',
      ' ',
      `╭─ yt-dlp ${'─'.repeat(39)}╮`,
      '│                                                │',
      '│  Status    Not installed                       │',
      '│                                                │',
      '│  Size      37.1 MB download                    │',
      '│                                                │',
      '╰────────────────────────────────────────────────╯',
      ' ',
      'Already have yt-dlp?',
    ])
    for (const line of text(rows)) expect([...line].length).toBeLessThanOrEqual(50)
  })

  it('draws the field fact on the shelf, its caret in the gold, and cuts what does not fit', () => {
    const rows = ownSheetRows(
      DARK,
      {
        name: 'YouTube links',
        gives: 'Transcribe YouTube videos, a line far too long for the sheet it is in',
        tag: 'yt-dlp',
        facts: [
          ['Status', [{ text: 'Not found on this Mac' }]],
          ['Path', [{ text: 'Drop it here, or type it' }]],
        ],
        field: 'Path',
      },
      50,
    )
    const path = rows[7] ?? []
    expect(path.map((r) => r.text).join('')).toMatch(/^│ {2}Path {6}› Drop it here, or type it +│$/)
    expect(path.find((r) => r.text === '› ')?.fg).toBe(DARK.brand)
    expect(path.some((r) => r.bg === DARK.shelf)).toBe(true)
    expect(text(rows)[1]).toMatch(/…$/)
    for (const line of text(rows)) expect([...line].length).toBeLessThanOrEqual(50)
  })
})
