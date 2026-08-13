export interface SelowImportRow {
  transactionDate: string
  transactionTime: string
  note: string
  amount: number
  merchant: string
  budgetCategoryId?: string
}

const pad = (value: number) => String(value).padStart(2, '0')

function excelDateParts(value: unknown) {
  let date: Date
  if (value instanceof Date && Number.isFinite(value.getTime())) date = value
  else if (typeof value === 'number' && Number.isFinite(value)) date = new Date(Date.UTC(1899, 11, 30) + Math.round(value * 86_400_000))
  else throw new Error('Kolom Date harus berisi tanggal dan waktu dari Selow.id')
  // Selow exports UTC serial values while its dashboard displays WIB.
  date = new Date(date.getTime() + 7 * 60 * 60 * 1000)
  return {
    transactionDate: `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`,
    transactionTime: `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`,
  }
}

export function selowMerchant(note: string) {
  const normalized = note.replace(/\s+/g, ' ').trim()
  if (!normalized) return 'Debit tanpa keterangan'
  return normalized.match(/^([A-Za-z0-9._-]+)(?:\s|\*)/)?.[1].toUpperCase() || normalized.slice(0, 40)
}

export function normalizeSelowRows(rawRows: unknown[][]): SelowImportRow[] {
  if (rawRows.length < 2) throw new Error('File Selow.id tidak memiliki transaksi')
  const headers = rawRows[0].slice(0, 3).map((value) => String(value ?? '').trim().toLowerCase())
  if (headers.join('|') !== 'date|note|amount') throw new Error('Format tidak dikenali. Kolom wajib: Date, Note, Amount')
  if (rawRows.length - 1 > 2000) throw new Error('Maksimal 2.000 transaksi dalam satu impor')

  return rawRows.slice(1).flatMap((row, index) => {
    if (row.every((value) => value === null || value === undefined || value === '')) return []
    try {
      const date = excelDateParts(row[0]),
        note = String(row[1] ?? '').replace(/\s+/g, ' ').trim(),
        amount = typeof row[2] === 'number' ? row[2] : Number(row[2])
      if (!Number.isFinite(amount) || Math.abs(amount) < 0.01) throw new Error('Amount harus berupa angka dan tidak boleh nol')
      if (Math.abs(amount) > 1e15) throw new Error('Amount melebihi batas sistem')
      return [{ ...date, note: note.slice(0, 240), amount, merchant: amount < 0 ? selowMerchant(note) : 'Top-up Selow.id' }]
    } catch (error) {
      throw new Error(`Baris ${index + 2}: ${error instanceof Error ? error.message : 'data tidak valid'}`)
    }
  })
}

export async function readSelowWorkbook(file: File) {
  if (!/\.xlsx$/i.test(file.name)) throw new Error('Pilih file Excel .xlsx dari Selow.id')
  if (file.size > 5 * 1024 * 1024) throw new Error('Ukuran file maksimal 5 MB')
  const { default: readXlsxFile } = await import('read-excel-file')
  const rows = (await readXlsxFile(file)) as unknown[][]
  return normalizeSelowRows(rows)
}
