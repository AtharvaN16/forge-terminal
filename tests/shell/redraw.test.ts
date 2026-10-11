import { describe, expect, it } from 'vitest'
import type { HistoryBlock } from '../../src/shell/blocks.js'
import { CLEAR_SCREEN, historyForRedraw } from '../../src/shell/redraw.js'

/**
 * A width change reflows every line already on screen, so Ink's own erase —
 * which counts the lines it wrote, not the rows the terminal now shows them
 * on — leaves the old frame behind (UX audit #5). The shell clears the screen
 * and replays history instead; these pin what that replay is made of.
 */
describe('redrawing history after a width change', () => {
  const history: HistoryBlock[] = [
    { kind: 'banner', id: 'a', width: 100, defaultOutput: '~/Desktop' },
    { kind: 'note', id: 'b', text: 'hello' },
    { kind: 'separator', id: 'c', width: 100 },
  ]

  it('redraws rules and the banner at the new width, leaving everything else alone', () => {
    const next = historyForRedraw(history, 50)
    expect(next).toEqual([
      { kind: 'banner', id: 'a', width: 50, defaultOutput: '~/Desktop' },
      { kind: 'note', id: 'b', text: 'hello' },
      { kind: 'separator', id: 'c', width: 50 },
    ])
  })

  it('puts the intro banner back on top, since clearing the screen takes it with it', () => {
    const intro: HistoryBlock = { kind: 'banner', id: 'i', width: 0, defaultOutput: '~/Desktop' }
    const next = historyForRedraw(history.slice(1), 60, intro)
    expect(next[0]).toEqual({ ...intro, width: 60 })
    expect(next).toHaveLength(3)
  })

  it('clears the visible screen and the scrollback, then homes the cursor', () => {
    // Without the scrollback erase the reflowed copies survive above the
    // screen, and the replay would duplicate every block a second time.
    expect(CLEAR_SCREEN).toBe('\u001b[2J\u001b[3J\u001b[H')
  })
})
