import { Text } from 'ink'
import { render } from 'ink-testing-library'
import { useEffect, useRef, useState } from 'react'
import { describe, expect, it } from 'vitest'
import type { HistoryBlock } from '../../src/shell/blocks.js'
import type { BannerState } from '../../src/shell/redraw.js'
import { useBannerTransition } from '../../src/shell/useBannerTransition.js'

const settle = (ms = 50) => new Promise((r) => setTimeout(r, ms))

/**
 * Another effect pushing to history in the same commit as the working edge
 * — the separator effect does exactly this — must not have its block thrown
 * away by the logo's replay.
 */
function Harness({ working }: { working: boolean }) {
  const [history, setHistory] = useState<HistoryBlock[]>([
    { kind: 'banner', id: 'B', width: 80, defaultOutput: '~' },
  ])
  const bannerState = useRef<BannerState>({ enabled: true, onScreen: true })
  useEffect(() => {
    if (working) setHistory((h) => [...h, { kind: 'note', id: 'n', text: 'pushed' }])
  }, [working])
  useBannerTransition({
    working,
    history,
    setHistory,
    bannerState,
    makeBanner: () => ({ kind: 'banner', id: 'B2', width: 80, defaultOutput: '~' }),
    width: 80,
    clear: () => {},
    remountStatic: () => {},
  })
  return <Text>{history.map((b) => b.kind).join(',')}</Text>
}

describe('useBannerTransition', () => {
  it('keeps a block another effect pushed in the same commit', async () => {
    const app = render(<Harness working={false} />)
    await settle()
    app.rerender(<Harness working={true} />)
    await settle()
    expect(app.lastFrame()).toBe('note')
  })
})
