import { describe, expect, it } from 'vitest'
import { formatCurrency, formatDate, formatIDR, initials } from './format'

describe('finance formatters', () => {
  it('formats Indonesian rupiah without decimal drift', () => {
    expect(formatIDR(125000000)).toContain('125.000.000')
  })

  it('keeps USD as a separate currency', () => {
    expect(formatCurrency(12.5, 'USD')).toContain('12.50')
  })

  it('formats local business dates predictably', () => {
    expect(formatDate('2026-08-10')).toContain('2026')
    expect(formatDate('2026-08-09T17:00:00.000Z')).toContain('10')
    expect(formatDate('not-a-date')).toBe('—')
  })

  it('creates compact vendor initials', () => {
    expect(initials('Amazon Web Services')).toBe('AW')
  })
})
