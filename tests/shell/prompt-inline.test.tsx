import { Text } from 'ink'
import { render } from 'ink-testing-library'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Prompt } from '../../src/shell/components/Prompt.js'

vi.hoisted(() => {
  process.env.FORCE_COLOR = '3'
  process.env.NO_COLOR = ''
})

const ESC = String.fromCharCode(27)
const LEFT = `${ESC}[D`
const settle = () => new Promise((r) => setTimeout(r, 60))
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')
const plain = (f: string | undefined) => (f ?? '').replace(SGR, '')
/** Reverse video on, then the character it covers. */
const INVERSE = `${ESC}[7m`

function Field({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial)
  return (
    <Prompt
      value={value}
      onChange={setValue}
      onSubmit={() => {}}
      placeholder="test"
      isActive
      variant="inline"
      suffix=".jpg"
      after={<Text>{'   in Desktop'}</Text>}
      width={60}
    />
  )
}

describe('the inline field, as Save as uses it', () => {
  it('reads as one line: the marker, the name, the fixed extension, then what follows', () => {
    const { lastFrame } = render(<Field initial="header" />)
    expect(plain(lastFrame())).toBe('› header.jpg   in Desktop')
  })

  it('puts the caret at the end on the extension, rather than adding a cell before it', () => {
    const { lastFrame } = render(<Field initial="header" />)
    expect(lastFrame()).toContain(`${INVERSE}.`)
  })

  it('moves the caret into the name, leaving the extension as it was', async () => {
    const { stdin, lastFrame } = render(<Field initial="header" />)
    stdin.write(LEFT)
    await settle()
    expect(lastFrame()).toContain(`${INVERSE}r`)
    expect(lastFrame()).not.toContain(`${INVERSE}.`)
    expect(plain(lastFrame())).toBe('› header.jpg   in Desktop')
  })

  it('shows the placeholder, dim, when the name is empty, the caret on its first letter', () => {
    const { lastFrame } = render(<Field initial="" />)
    expect(plain(lastFrame())).toBe('› test.jpg   in Desktop')
    expect(lastFrame()).toContain(`${INVERSE}t`)
  })
})
