import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import type { Result } from '../../src/core/types.js'
import { ReceiptCard } from '../../src/shell/components/ReceiptCard.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { DARK } from '../../src/shell/theme.js'
import { receiptResult as result } from './receipt-fixtures.js'

vi.hoisted(() => {
  process.env.FORCE_COLOR = '3'
  process.env.NO_COLOR = ''
})

const rgb = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16)
  return `${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}`
}
const frame = (r: Result) =>
  render(
    <ThemeProvider palette={DARK}>
      <ReceiptCard result={r} width={80} />
    </ThemeProvider>,
  ).lastFrame() ?? ''

describe('receipt colour', () => {
  it('draws the after bar in ok when smaller and in larger when it grew', () => {
    expect(frame(result())).toContain(`38;2;${rgb(DARK.ok)}m███`)
    expect(frame(result({ bytes: 400_000 }))).toContain(`38;2;${rgb(DARK.larger)}m███`)
  })
  it('keeps an ok border even when the file grew', () => {
    expect(frame(result({ bytes: 400_000 }))).toContain(`38;2;${rgb(DARK.ok)}m╭`)
  })
})
