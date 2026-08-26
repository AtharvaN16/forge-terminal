import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import { ClickTargetProvider, useClickTargetRegistry } from '../../src/shell/ClickTargets.js'
import { ResultLinks } from '../../src/shell/components/ResultLinks.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { paletteFor } from '../../src/shell/theme.js'

function mount() {
  const onOpen = vi.fn()
  const onReveal = vi.fn()
  let registry!: ReturnType<typeof useClickTargetRegistry>
  function Harness() {
    registry = useClickTargetRegistry()
    return (
      <ResultLinks
        outputPath="/tmp/photo.webp"
        revealLabel="Reveal in Finder"
        onOpen={onOpen}
        onReveal={onReveal}
      />
    )
  }
  const app = render(
    <ThemeProvider palette={paletteFor('dark')}>
      <ClickTargetProvider>
        <Harness />
      </ClickTargetProvider>
    </ThemeProvider>,
  )
  return {
    app,
    onOpen,
    onReveal,
    get registry() {
      return registry
    },
  }
}

describe('ResultLinks', () => {
  it('renders both labels regardless of OSC 8 support', () => {
    const h = mount()
    // Terminal.app supports no OSC 8; the labels must still be on screen,
    // because they are now real click targets rather than terminal hyperlinks.
    expect(h.app.lastFrame()).toContain('Open file')
    expect(h.app.lastFrame()).toContain('Reveal in Finder')
    h.app.unmount()
  })

  it('registers a target for each link', () => {
    const h = mount()
    expect(h.registry.size()).toBe(2)
    h.app.unmount()
  })

  it('opens the file when "Open file" is clicked', () => {
    const h = mount()
    const target = h.registry.hitTest({ row: 0, col: 1 })
    target?.onClick({ row: 0, col: 1 })
    expect(h.onOpen).toHaveBeenCalledOnce()
    expect(h.onReveal).not.toHaveBeenCalled()
    h.app.unmount()
  })

  it('reveals when the second link is clicked', () => {
    const h = mount()
    // 'Open file' is 9 cells, then a '  ·  ' separator: the reveal label
    // starts well past column 12.
    const target = h.registry.hitTest({ row: 0, col: 20 })
    target?.onClick({ row: 0, col: 20 })
    expect(h.onReveal).toHaveBeenCalledOnce()
    h.app.unmount()
  })
})
