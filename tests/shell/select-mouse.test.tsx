import { render } from 'ink-testing-library'
import { act } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ClickTargetProvider, useClickTargetRegistry } from '../../src/shell/ClickTargets.js'
import { Select } from '../../src/shell/components/Select.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { paletteFor, SYMBOLS } from '../../src/shell/theme.js'

const items = [
  { label: 'First', value: 'first' },
  { label: 'Second', value: 'second' },
  { label: 'Third', value: 'third', disabled: true },
]

function Harness({
  onSubmit,
  onRegistry,
}: {
  onSubmit: (v: string) => void
  onRegistry: (r: ReturnType<typeof useClickTargetRegistry>) => void
}) {
  const registry = useClickTargetRegistry()
  onRegistry(registry)
  return <Select items={items} onSubmit={onSubmit} width={40} />
}

function mount() {
  const onSubmit = vi.fn()
  let registry!: ReturnType<typeof useClickTargetRegistry>
  const app = render(
    <ThemeProvider palette={paletteFor('dark')}>
      <ClickTargetProvider>
        <Harness
          onSubmit={onSubmit}
          onRegistry={(r) => {
            registry = r
          }}
        />
      </ClickTargetProvider>
    </ThemeProvider>,
  )
  return {
    app,
    onSubmit,
    get registry() {
      return registry
    },
  }
}

describe('Select mouse support', () => {
  it('submits the row that was clicked — the same path Enter takes', () => {
    const h = mount()
    const target = h.registry.hitTest({ row: 1, col: 1 })
    expect(target).not.toBeNull()
    target?.onClick({ row: 0, col: 1 })
    expect(h.onSubmit).toHaveBeenCalledWith('second')
    h.app.unmount()
  })

  it('registers no target for a disabled row', () => {
    const h = mount()
    // Row 2 is the disabled 'Third'; arrow keys skip it, so a click must too.
    const target = h.registry.hitTest({ row: 2, col: 1 })
    expect(target).toBeNull()
    h.app.unmount()
  })

  it('moves the highlight on hover', async () => {
    const h = mount()
    const second = h.registry.hitTest({ row: 1, col: 1 })
    // Ink only commits React state updates on its own render path — invoking
    // the callback directly and reading lastFrame() synchronously would see
    // stale output, so the update must be flushed inside act().
    await act(async () => {
      second?.onHover?.(true)
    })
    // The highlight arrow is what the keyboard moves; hover must move the
    // same one rather than introduce a second kind of selection. SYMBOLS.cursor
    // is the actual glyph Select draws for the keyboard cursor too.
    expect(h.app.lastFrame()).toContain(`${SYMBOLS.cursor} Second`)
    h.app.unmount()
  })

  it('submits the hovered row when it is clicked', async () => {
    const h = mount()
    const second = h.registry.hitTest({ row: 1, col: 1 })
    await act(async () => {
      second?.onHover?.(true)
    })
    second?.onClick({ row: 0, col: 1 })
    expect(h.onSubmit).toHaveBeenCalledWith('second')
    h.app.unmount()
  })
})
