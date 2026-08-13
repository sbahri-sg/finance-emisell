import { describe, expect, it } from 'vitest'
import { normalizeSelowRows, selowMerchant } from './selowImport'

describe('Selow.id workbook import', () => {
  it('normalizes the official Date, Note, Amount export', () => {
    const rows = normalizeSelowRows([
      ['Date', 'Note', 'Amount'],
      [new Date('2026-08-12T10:46:00.000Z'), 'FACEBK *BGUJUYR392       Dublin       IE', -39772],
      [new Date('2026-08-07T08:00:00.000Z'), null, 5000301],
    ])
    expect(rows).toEqual([
      { transactionDate: '2026-08-12', transactionTime: '17:46:00', note: 'FACEBK *BGUJUYR392 Dublin IE', amount: -39772, merchant: 'FACEBK' },
      { transactionDate: '2026-08-07', transactionTime: '15:00:00', note: '', amount: 5000301, merchant: 'Top-up Selow.id' },
    ])
  })

  it('rejects a workbook with changed headers', () => {
    expect(() => normalizeSelowRows([['Tanggal', 'Keterangan', 'Nominal'], ['2026-08-12', 'Test', -1]])).toThrow('Date, Note, Amount')
  })

  it('groups merchants without storing card secrets', () => {
    expect(selowMerchant('DIGITALOCEAN.COM invoice 123')).toBe('DIGITALOCEAN.COM')
  })
})
