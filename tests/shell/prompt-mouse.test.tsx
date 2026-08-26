import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import { ClickTargetProvider, useClickTargetRegistry } from '../../src/shell/ClickTargets.js'
import { Prompt } from '../../src/shell/components/Prompt.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { paletteFor } from '../../src/shell/theme.js'

function mount(value: string, opts: { isActive?: boolean } = {}) {
  const onChange = vi.fn()
  let registry!: ReturnType<typeof useClickTargetRegistry>
  function Harness() {
    registry = useClickTargetRegistry()
    return (
      <Prompt
        value={value}
        onChange={onChange}
        onSubmit={vi.fn()}
        placeholder="drop a file"
        isActive={opts.isActive ?? true}
        variant="plain"
        width={40}
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
    onChange,
    get registry() {
      return registry
    },
  }
}

describe('Prompt click-to-position', () => {
  it('registers a target covering the text', () => {
    const h = mount('hello.png')
    expect(h.registry.size()).toBeGreaterThan(0)
    h.app.unmount()
  })

  it('moves the caret to the clicked character', () => {
    const h = mount('hello.png')
    // Column 5 is the '.', counting from the first character of the text.
    h.registry.hitTest({ row: 0, col: 5 })?.onClick({ row: 0, col: 5 })
    // Assert by effect, the way prompt-selection.test.tsx does: type, and see
    // where the character landed. Far more robust than matching the caret's
    // inverse-video run, which renders differently under NO_COLOR.
    h.app.stdin.write('X')
    expect(h.onChange).toHaveBeenLastCalledWith('helloX.png')
    h.app.unmount()
  })

  it('clamps a click past the end of the text to the end', () => {
    const h = mount('ab')
    h.registry.hitTest({ row: 0, col: 30 })?.onClick({ row: 0, col: 30 })
    h.app.stdin.write('X')
    // `offsetForColumn` returns the character count for any column past the
    // text, so the caret lands after 'b' — never beyond the buffer.
    expect(h.onChange).toHaveBeenLastCalledWith('abX')
    h.app.unmount()
  })

  it('leaves the caret alone when the prompt is inactive', () => {
    const h = mount('hello.png', { isActive: false })
    // An inactive prompt registers nothing, so a click cannot reach it — the
    // same rule its `useKeys({ isActive })` gate already applies to keys.
    expect(h.registry.hitTest({ row: 0, col: 5 })).toBeNull()
    h.app.unmount()
  })
})
