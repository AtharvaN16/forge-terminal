import type { Key } from 'ink'
import { render } from 'ink-testing-library'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Prompt } from '../../src/shell/components/Prompt.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { DARK } from '../../src/shell/theme.js'

vi.hoisted(() => {
  process.env.FORCE_COLOR = '3'
  process.env.NO_COLOR = ''
})

const ESC = String.fromCharCode(27)
const TAB = '\t'
const UP = `${ESC}[A`
const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms))
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')
const plain = (f: string | undefined) => (f ?? '').replace(SGR, '')

type Intercept = (input: string, key: Key, value: string) => boolean

function Field({
  intercept,
  initial = '',
  seen,
}: {
  intercept?: Intercept
  initial?: string
  seen?: (v: string) => void
}) {
  const [value, setValue] = useState(initial)
  seen?.(value)
  return (
    <ThemeProvider palette={DARK}>
      <Prompt
        value={value}
        onChange={setValue}
        onSubmit={() => {}}
        placeholder="or type a path"
        isActive
        variant="home"
        width={80}
        {...(intercept ? { intercept } : {})}
      />
    </ThemeProvider>
  )
}

describe('the home field', () => {
  it('sits four columns in, with the placeholder straight after the marker', () => {
    const { lastFrame } = render(<Field />)
    expect(plain(lastFrame())).toBe('    › or type a path')
  })

  it('shows what is typed after the same marker', async () => {
    const { lastFrame, stdin } = render(<Field />)
    stdin.write('~/Desk')
    await settle()
    expect(plain(lastFrame()).trimEnd()).toBe('    › ~/Desk')
  })

  it('draws the caret on the placeholder’s first letter rather than before it', () => {
    const { lastFrame } = render(<Field />)
    expect(lastFrame()).toContain(`${ESC}[7mo${ESC}[27m`)
  })
})

describe('intercept', () => {
  it('lets the owner take a key before the field types it', async () => {
    const calls: Array<[string, string]> = []
    let value = ''
    const { stdin } = render(
      <Field
        intercept={(input, _key, current) => {
          calls.push([input, current])
          return input === '2'
        }}
        seen={(v) => {
          value = v
        }}
      />,
    )
    stdin.write('2')
    await settle()
    expect(value).toBe('')
    expect(calls).toContainEqual(['2', ''])
    stdin.write('a')
    await settle()
    expect(value).toBe('a')
  })

  it('hands the owner keys the field has no use for', async () => {
    const keys: string[] = []
    const { stdin } = render(
      <Field
        intercept={(_input, key) => {
          if (key.tab) keys.push('tab')
          if (key.upArrow) keys.push('up')
          return key.tab || key.upArrow
        }}
      />,
    )
    stdin.write(TAB)
    await settle()
    stdin.write(UP)
    await settle()
    expect(keys).toEqual(['tab', 'up'])
  })
})

describe('tab', () => {
  it('is never typed into the field', async () => {
    let value = ''
    const { stdin } = render(
      <Field
        initial="ab"
        seen={(v) => {
          value = v
        }}
      />,
    )
    stdin.write(TAB)
    await settle()
    expect(value).toBe('ab')
  })
})
