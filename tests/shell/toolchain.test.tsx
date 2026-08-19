import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { Hello } from '../../src/shell/components/Hello.js'

describe('shell toolchain', () => {
  it('renders an ink component', () => {
    const { lastFrame } = render(<Hello name="Forge" />)
    expect(lastFrame()).toContain('Forge')
  })
})
