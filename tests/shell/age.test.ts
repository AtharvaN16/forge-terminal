import { describe, expect, it } from 'vitest'
import { describeAge } from '../../src/shell/age.js'

const now = new Date(2026, 9, 11, 22, 50)

describe('describeAge', () => {
  it('says today with the time, for a file changed today', () => {
    expect(describeAge(new Date(2026, 9, 11, 9, 5), now)).toBe('today, 09:05')
  })
  it('says yesterday with the time', () => {
    expect(describeAge(new Date(2026, 9, 10, 18, 42), now)).toBe('yesterday, 18:42')
  })
  it('says the day and month this year', () => {
    expect(describeAge(new Date(2026, 8, 3, 12, 0), now)).toBe('3 Sep')
  })
  it('adds the year for another year', () => {
    expect(describeAge(new Date(2025, 11, 24, 12, 0), now)).toBe('24 Dec 2025')
  })
})
