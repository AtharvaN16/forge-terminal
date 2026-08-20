import { render } from 'ink-testing-library'
import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { CommandPalette } from '../../src/shell/components/CommandPalette.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { DARK } from '../../src/shell/theme.js'

const ENTER = String.fromCharCode(13)
const DOWN = `${String.fromCharCode(27)}[B`
const NL = String.fromCharCode(10)
const settle = (ms = 80) => new Promise((r) => setTimeout(r, ms))

const show = (node: ReactElement) => render(<ThemeProvider palette={DARK}>{node}</ThemeProvider>)

describe('CommandPalette', () => {
  it('lists every command for a bare slash', () => {
    const frame =
      show(
        <CommandPalette fragment="" width={80} onRun={() => {}} onCancel={() => {}} />,
      ).lastFrame() ?? ''
    expect(frame).toContain('/convert')
    expect(frame).toContain('/compress')
    expect(frame).toContain('/theme')
    expect(frame).toContain('/help')
  })

  it('shows each description, which is what makes commands findable', () => {
    const frame =
      show(
        <CommandPalette fragment="" width={80} onRun={() => {}} onCancel={() => {}} />,
      ).lastFrame() ?? ''
    expect(frame).toContain('make a file smaller')
  })

  it('narrows as the fragment grows', () => {
    const frame =
      show(
        <CommandPalette fragment="comp" width={80} onRun={() => {}} onCancel={() => {}} />,
      ).lastFrame() ?? ''
    expect(frame).toContain('/compress')
    expect(frame).not.toContain('/theme')
  })

  it('runs the highlighted command on enter', async () => {
    const onRun = vi.fn()
    const { stdin } = show(
      <CommandPalette fragment="" width={80} onRun={onRun} onCancel={() => {}} />,
    )
    stdin.write(DOWN)
    await settle()
    stdin.write(ENTER)
    await settle()
    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ name: 'compress' }))
  })

  it('says so when nothing matches, rather than rendering an empty box', () => {
    const frame =
      show(
        <CommandPalette fragment="zzz" width={80} onRun={() => {}} onCancel={() => {}} />,
      ).lastFrame() ?? ''
    expect(frame.toLowerCase()).toContain('no command')
  })

  it('never draws wider than the terminal', () => {
    for (const w of [40, 60, 80]) {
      const frame =
        show(
          <CommandPalette fragment="" width={w} onRun={() => {}} onCancel={() => {}} />,
        ).lastFrame() ?? ''
      for (const line of frame.split(NL)) expect(line.length).toBeLessThanOrEqual(w)
    }
  })
})
