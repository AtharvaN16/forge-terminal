import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import { ClickTargetProvider } from '../../src/shell/ClickTargets.js'
import { Prompt } from '../../src/shell/components/Prompt.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { paletteFor } from '../../src/shell/theme.js'

const ENTER = String.fromCharCode(13)
const settle = (ms = 120) => new Promise((r) => setTimeout(r, ms))

function mount(value: string, onSubmit: (v: string) => void, disableSubmit?: boolean) {
  return render(
    <ThemeProvider palette={paletteFor('dark')}>
      <ClickTargetProvider>
        <Prompt
          value={value}
          onChange={vi.fn()}
          onSubmit={onSubmit}
          placeholder="drop a file"
          isActive
          variant="plain"
          width={40}
          {...(disableSubmit === undefined ? {} : { disableSubmit })}
        />
      </ClickTargetProvider>
    </ThemeProvider>,
  )
}

/**
 * `App` mounts `CommandPalette`'s `Select` alongside this component whenever
 * the typed buffer opens a command — both live `useInput` hooks reacting to
 * the same keystroke. That is deliberate for every key except Enter: `Select`
 * already submits the highlighted command on Enter, so this component doing
 * the same thing to the same buffer is two independent writers racing one
 * keystroke, not two opinions worth having. Reproduced against the built
 * binary in a real terminal — see `disableSubmit`'s doc comment in
 * Prompt.tsx for exactly what that race produced (`/pdf/pdf`, then a bogus
 * "file not found"). `disableSubmit` is how `App` tells this component to
 * leave that keystroke to `Select` entirely.
 */
describe('Prompt — disableSubmit', () => {
  it('does not call onSubmit on Enter while disableSubmit is set', async () => {
    const onSubmit = vi.fn()
    const app = mount('/pdf', onSubmit, true)
    app.stdin.write(ENTER)
    await settle()
    expect(onSubmit).not.toHaveBeenCalled()
    app.unmount()
  })

  it('still submits on Enter when disableSubmit is left unset', async () => {
    const onSubmit = vi.fn()
    const app = mount('/pdf', onSubmit)
    app.stdin.write(ENTER)
    await settle()
    expect(onSubmit).toHaveBeenCalledWith('/pdf')
    app.unmount()
  })

  it('still submits on Enter when disableSubmit is explicitly false', async () => {
    const onSubmit = vi.fn()
    const app = mount('/pdf', onSubmit, false)
    app.stdin.write(ENTER)
    await settle()
    expect(onSubmit).toHaveBeenCalledWith('/pdf')
    app.unmount()
  })
})
