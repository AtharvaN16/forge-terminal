import { describe, expect, it } from 'vitest'
import { clockOf, parseCut, parseTime, stepsFor, timeOf } from '../../src/core/timecode.js'

describe('parseTime', () => {
  it.each([
    ['41', 41],
    ['0:41', 41],
    ['1:02.5', 62.5],
    ['1:02:03', 3723],
    ['2.25', 2.25],
    [' 0:03.2 ', 3.2],
  ])('reads %s as %d s', (text, seconds) => {
    expect(parseTime(text)).toBeCloseTo(seconds)
  })

  it.each(['', 'abc', '1:60', '-3', '1::2', '1:2:3:4'])('refuses %s', (text) => {
    expect(parseTime(text)).toBeUndefined()
  })
})

describe('parseCut', () => {
  it('reads start-end', () => {
    expect(parseCut('0:03.2-0:41')).toEqual({ start: 3.2, end: 41 })
  })
  it('refuses an end before the start', () => {
    expect(parseCut('0:41-0:03')).toBeUndefined()
  })
  it('allows an open end', () => {
    expect(parseCut('0:10-')).toEqual({ start: 10, end: undefined })
  })
})

describe('timeOf and clockOf', () => {
  it('writes tenths for the fields', () => {
    expect(timeOf(3.2)).toBe('0:03.2')
    expect(timeOf(62.04)).toBe('1:02.0')
    expect(timeOf(3723.4)).toBe('1:02:03.4')
  })
  it('writes whole seconds for lengths', () => {
    expect(clockOf(130)).toBe('2:10')
    expect(clockOf(3492)).toBe('58:12')
    expect(clockOf(3723)).toBe('1:02:03')
  })
})

describe('stepsFor', () => {
  it('offers steps up to about a quarter of the length', () => {
    expect(stepsFor(130)).toEqual([1, 5, 10, 30])
    expect(stepsFor(3600)).toEqual([1, 5, 10, 30, 60, 300, 600])
    expect(stepsFor(3 * 3600)).toEqual([1, 5, 10, 30, 60, 300, 600, 1800])
  })
  it('always offers one second', () => {
    expect(stepsFor(2)).toEqual([1])
  })
})
