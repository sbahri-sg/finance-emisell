import { describe, expect, it } from 'vitest'
import { formatMoneyInput, parseMoneyInput } from '../lib/moneyInput'

describe('MoneyInput', () => {
  it('formats rupiah nominal with Indonesian thousand separators', () => {
    expect(parseMoneyInput('5500000', 0)).toBe('5500000')
    expect(formatMoneyInput('5500000', 0)).toBe('5.500.000')
  })

  it('accepts an already formatted nominal and pasted currency text', () => {
    expect(parseMoneyInput('5.500.000', 0)).toBe('5500000')
    expect(parseMoneyInput('Rp 5.500.000', 0)).toBe('5500000')
  })

  it('supports provider balances with two decimal digits', () => {
    expect(parseMoneyInput('1.924.741,02', 2)).toBe('1924741.02')
    expect(parseMoneyInput('1924741.02', 2)).toBe('1924741.02')
    expect(formatMoneyInput('1924741.02', 2)).toBe('1.924.741,02')
  })
})
