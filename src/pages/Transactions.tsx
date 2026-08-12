import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowDownLeft, ArrowUpRight, BanknoteArrowDown, Check, Download, Filter, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { Badge, Button, Card, Modal, PageHeader } from '../components/ui'
import { useFinance } from '../lib/FinanceContext'
import { formatDate, formatIDR } from '../lib/format'
import type { BudgetCategory, Transaction } from '../types'

const currentMonth = new Date().toISOString().slice(0, 7)
const today = new Date().toISOString().slice(0, 10)

export function Transactions() {
  const { transactions: items, accounts, refresh, user, settings } = useFinance()
  const [searchParams, setSearchParams] = useSearchParams()
  const [query, setQuery] = useState(() => searchParams.get('search') || '')
  const [kind, setKind] = useState('all')
  const [modal, setModal] = useState(false)
  const [expenseModal, setExpenseModal] = useState(false)
  const [editing, setEditing] = useState<Transaction | null>(null)
  const [budgetCategories, setBudgetCategories] = useState<BudgetCategory[]>([])
  const [expenseAmount, setExpenseAmount] = useState(0)
  const [expenseDescription, setExpenseDescription] = useState('')
  const [expenseCategory, setExpenseCategory] = useState('Utilities & Langganan')
  const [expenseBudgetCategoryId, setExpenseBudgetCategoryId] = useState('')
  const [expenseBudgetItemName, setExpenseBudgetItemName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const cashAccounts = accounts.filter((account) => ['bank', 'cash', 'ewallet'].includes(account.kind))
  const canPost = user?.role === 'owner' || user?.role === 'admin' || user?.role === 'finance'
  useEffect(() => {
    const searchValue = searchParams.get('search')
    if (searchValue !== null) setQuery(searchValue)
    const action = searchParams.get('buat')
    if (action === 'income') {
      setError('')
      setEditing(null)
      setModal(true)
    }
    if (action === 'expense' && canPost) {
      setError('')
      openExpense(null)
    }
    if (action) {
      const next = new URLSearchParams(searchParams)
      next.delete('buat')
      setSearchParams(next, { replace: true })
    }
  }, [canPost, searchParams, setSearchParams])
  useEffect(() => {
    void fetch(`/api/budgets?month=${currentMonth}`, { credentials: 'include' })
      .then((response) => (response.ok ? response.json() : null))
      .then((raw) =>
        setBudgetCategories(
          (raw?.categories || []).map((category: BudgetCategory) => ({
            ...category,
            plannedAmount: Number(category.plannedAmount),
            actual: Number(category.actual),
            pendingAmount: Number(category.pendingAmount),
            committedAmount: Number(category.committedAmount),
            budgetModel: category.budgetModel || 'fixed',
            lineItems: (category.lineItems || []).map((item) => ({ name: item.name, quantity: Number(item.quantity), unitPrice: Number(item.unitPrice) })),
          })),
        ),
      )
  }, [])
  const filtered = useMemo(() => items.filter((item) => `${item.description} ${item.reference} ${item.category} ${item.counterparty || ''}`.toLowerCase().includes(query.toLowerCase()) && (kind === 'all' || item.kind === kind)), [items, kind, query])
  const expenseBudgetItemValue = useMemo(() => {
    if (!expenseBudgetCategoryId || !expenseBudgetItemName) return ''
    const category = budgetCategories.find((item) => item.id === expenseBudgetCategoryId)
    const itemIndex = category?.lineItems.findIndex((item) => item.name === expenseBudgetItemName) ?? -1
    return itemIndex >= 0 ? `${expenseBudgetCategoryId}:${itemIndex}` : ''
  }, [budgetCategories, expenseBudgetCategoryId, expenseBudgetItemName])
  const monthItems = items.filter((item) => item.date.startsWith(currentMonth))
  const incomeTotal = monthItems.filter((item) => item.kind === 'income' && item.status === 'posted').reduce((sum, item) => sum + Math.max(0, item.amount), 0)
  const expenseTotal = Math.abs(monthItems.filter((item) => item.amount < 0 && item.status === 'posted').reduce((sum, item) => sum + item.amount, 0))
  const pendingTotal = monthItems.filter((item) => item.status === 'pending' || item.status === 'draft').reduce((sum, item) => sum + Math.abs(item.amount), 0)

  async function createIncome(formData: FormData) {
    setSaving(true)
    setError('')
    try {
      const payload = {
        transactionDate: String(formData.get('transactionDate')),
        amount: Number(formData.get('amount')),
        accountId: String(formData.get('accountId')),
        description: String(formData.get('description')).trim(),
        sourceType: String(formData.get('sourceType')),
        counterparty: String(formData.get('counterparty')).trim() || undefined,
        paymentMethod: String(formData.get('paymentMethod')),
        proofUrl: String(formData.get('proofUrl')).trim() || undefined,
      }
      const response = await fetch(editing ? `/api/transactions/${editing.id}` : '/api/income', {
        method: editing ? 'PATCH' : 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = (await response.json().catch(() => ({}))) as {
        error?: string
      }
      if (!response.ok) throw new Error(body.error || 'Dana masuk belum dapat disimpan')
      await refresh()
      setModal(false)
      setEditing(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Terjadi kesalahan')
    } finally {
      setSaving(false)
    }
  }
  async function createExpense(formData: FormData) {
    setSaving(true)
    setError('')
    try {
      const payload = {
        transactionDate: String(formData.get('transactionDate')),
        amount: expenseAmount,
        accountId: String(formData.get('accountId')),
        description: expenseDescription.trim(),
        category: expenseCategory,
        budgetCategoryId: expenseBudgetCategoryId || undefined,
        budgetItemName: expenseBudgetItemValue ? expenseBudgetItemName : undefined,
        counterparty: String(formData.get('counterparty')).trim() || undefined,
        paymentMethod: String(formData.get('paymentMethod')),
        proofUrl: String(formData.get('proofUrl')).trim() || undefined,
        overrideReason: String(formData.get('overrideReason')).trim() || undefined,
      }
      const response = await fetch(editing ? `/api/transactions/${editing.id}` : '/api/expenses', {
        method: editing ? 'PATCH' : 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = (await response.json().catch(() => ({}))) as {
        error?: string
      }
      if (!response.ok) throw new Error(body.error || 'Pengeluaran belum dapat disimpan')
      await refresh()
      setExpenseModal(false)
      setEditing(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Terjadi kesalahan')
    } finally {
      setSaving(false)
    }
  }
  async function removeTransaction(transaction: Transaction) {
    if (!window.confirm(`Hapus ${transaction.description}? Sistem tetap menyimpan jejak koreksi untuk audit.`)) return
    setSaving(true)
    setError('')
    try {
      const response = await fetch(`/api/transactions/${transaction.id}/reverse`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transactionDate: today, reason: 'Dihapus dari daftar transaksi' }) })
      const body = (await response.json().catch(() => ({}))) as { error?: string }
      if (!response.ok) throw new Error(body.error || 'Transaksi belum dapat dihapus')
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Terjadi kesalahan')
    } finally {
      setSaving(false)
    }
  }
  function editTransaction(transaction: Transaction) {
    setError('')
    if (transaction.kind === 'income') setModal(true)
    else openExpense(transaction)
  }
  function openExpense(transaction: Transaction | null) {
    setEditing(transaction)
    setExpenseAmount(transaction ? Math.abs(transaction.amount) : 0)
    setExpenseDescription(transaction?.description || '')
    setExpenseCategory(transaction?.category && ['Utilities & Langganan', 'Konsumsi & Pantry', 'Kebersihan & Perlengkapan', 'Kegiatan', 'Personalia', 'Lain-Lain'].includes(transaction.category) ? transaction.category : 'Lain-Lain')
    setExpenseBudgetCategoryId(transaction?.budgetCategoryId || '')
    setExpenseBudgetItemName(transaction?.budgetItemName || '')
    setExpenseModal(true)
  }
  function selectBudgetItem(value: string) {
    if (!value) {
      setExpenseBudgetItemName('')
      return
    }
    const [categoryId, itemIndexText] = value.split(':')
    const category = budgetCategories.find((item) => item.id === categoryId)
    const item = category?.lineItems[Number(itemIndexText)]
    if (!category || !item) return
    setExpenseBudgetCategoryId(category.id)
    setExpenseBudgetItemName(item.name)
    setExpenseDescription(item.name)
    setExpenseAmount(item.quantity * item.unitPrice)
    setExpenseCategory(category.expenseCategory || 'Lain-Lain')
  }
  async function postTransaction(id: string) {
    setSaving(true)
    setError('')
    try {
      const response = await fetch(`/api/transactions/${id}/post`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      })
      const body = (await response.json().catch(() => ({}))) as {
        error?: string
      }
      if (!response.ok) throw new Error(body.error || 'Transaksi belum dapat diposting')
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Terjadi kesalahan')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="OPERASIONAL"
        title="Transaksi"
        description="Catat dana masuk, pengeluaran, dan pantau seluruh arus dana."
        action={
          <>
            <a className="button button-secondary" href="/api/exports/transactions.csv">
              <Download size={16} /> Ekspor
            </a>
            {canPost && (
              <Button
                variant="secondary"
                onClick={() => {
                  setError('')
                  openExpense(null)
                }}
              >
                <ArrowUpRight size={16} /> Catat pengeluaran
              </Button>
            )}
            <Button
              onClick={() => {
                setError('')
                setEditing(null)
                setModal(true)
              }}
            >
              <Plus size={16} /> Catat dana masuk
            </Button>
          </>
        }
      />
      {error && !modal && !expenseModal && (
        <div className="budget-alert error">
          <span>{error}</span>
          <button onClick={() => setError('')}>Tutup</button>
        </div>
      )}
      <div className="mini-stats">
        <Card>
          <span>Dana masuk bulan ini</span>
          <strong className="positive">{formatIDR(incomeTotal)}</strong>
          <small>{monthItems.filter((item) => item.kind === 'income' && item.status === 'posted').length} transaksi diposting</small>
        </Card>
        <Card>
          <span>Dana keluar bulan ini</span>
          <strong>{formatIDR(expenseTotal)}</strong>
          <small>{monthItems.filter((item) => item.amount < 0 && item.status === 'posted').length} transaksi diposting</small>
        </Card>
        <Card>
          <span>Menunggu verifikasi</span>
          <strong>{formatIDR(pendingTotal)}</strong>
          <small className="warning-text">{monthItems.filter((item) => item.status !== 'posted').length} transaksi</small>
        </Card>
      </div>
      <Card className="data-card">
        <div className="table-toolbar">
          <label className="table-search">
            <Search size={17} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari transaksi, pengirim, atau referensi" />
          </label>
          <div className="filter-group">
            <Filter size={16} />
            <select value={kind} onChange={(event) => setKind(event.target.value)}>
              <option value="all">Semua jenis</option>
              <option value="income">Dana masuk</option>
              <option value="expense">Pengeluaran</option>
              <option value="transfer">Transfer</option>
              <option value="deposit">Deposit</option>
            </select>
          </div>
        </div>
        <div className="table-scroll">
          <table className="transaction-table">
            <thead>
              <tr>
                <th>Transaksi</th>
                <th>Tanggal</th>
                <th>Kategori</th>
                <th>Rekening</th>
                <th>Status</th>
                <th>Bukti</th>
                <th className="align-right">Nominal</th>
                <th className="align-right">Tindakan</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((trx) => (
                <tr key={trx.id}>
                  <td>
                    <div className={`trx-icon ${trx.amount > 0 ? 'in' : 'out'}`}>{trx.amount > 0 ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}</div>
                    <span>
                      <strong>{trx.description}</strong>
                      <small>
                        {trx.counterparty ? `${trx.counterparty} · ` : ''}
                        {trx.reference || 'Tanpa referensi'}
                      </small>
                    </span>
                  </td>
                  <td>{formatDate(trx.date)}</td>
                  <td>{trx.category}</td>
                  <td>{trx.account || '—'}</td>
                  <td>
                    <Badge tone={trx.status === 'posted' ? 'success' : trx.status === 'pending' ? 'warning' : 'neutral'}>{trx.status === 'posted' ? 'Selesai' : trx.status === 'pending' ? 'Pending' : 'Draft'}</Badge>
                  </td>
                  <td>
                    {trx.proofUrl ? (
                      <a href={trx.proofUrl} target="_blank" rel="noreferrer">
                        Lihat bukti
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className={`align-right amount ${trx.amount > 0 ? 'positive' : ''}`}>
                    {trx.amount > 0 ? '+' : ''}
                    {formatIDR(trx.amount)}
                  </td>
                  <td className="align-right">
                    <div className="row-actions">
                      {canPost && trx.status !== 'posted' ? (
                        <button className="approve" disabled={saving} onClick={() => postTransaction(trx.id)}>
                          <Check size={13} /> Posting
                        </button>
                      ) : canPost && trx.status === 'posted' && trx.kind !== 'reversal' ? (
                        <>
                          {trx.editable && (
                            <button className="approve icon-action" title="Edit" aria-label={`Edit ${trx.description}`} onClick={() => editTransaction(trx)}>
                              <Pencil size={14} />
                            </button>
                          )}
                          <button className="reject" aria-label={`Hapus ${trx.description}`} onClick={() => void removeTransaction(trx)}>
                            <Trash2 size={14} />
                          </button>
                        </>
                      ) : (
                        <span>—</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!items.length && (
          <div className="dashboard-empty table-empty">
            <BanknoteArrowDown size={26} />
            <strong>Belum ada transaksi</strong>
            <span>Catat dana masuk pertama untuk memperbarui saldo rekening perusahaan.</span>
          </div>
        )}
        <div className="table-footer">
          Menampilkan {filtered.length} dari {items.length} transaksi <span>Data tersimpan dalam ledger perusahaan</span>
        </div>
      </Card>

      {modal && (
        <Modal
          title={editing ? 'Edit dana masuk' : 'Catat dana masuk'}
          description={editing ? 'Data lama digantikan di daftar dan rekap; jejak audit tetap tersimpan.' : 'Dana dicatat ke rekening perusahaan dengan jurnal berpasangan.'}
          onClose={() => {
            setModal(false)
            setEditing(null)
            setError('')
          }}
        >
          <form className="form-grid" action={createIncome}>
            {error && <div className="auth-error span-2">{error}</div>}
            <label>
              Sumber dana
              <select name="sourceType" defaultValue={editing?.incomeSource || 'service_income'}>
                <option value="product_sale">Penjualan produk</option>
                <option value="service_income">Pendapatan jasa</option>
                <option value="commission">Komisi/afiliasi</option>
                <option value="vendor_refund">Refund</option>
                <option value="owner_capital">Setoran modal</option>
                <option value="company_loan">Pinjaman perusahaan</option>
                <option value="other">Lain-lain</option>
              </select>
            </label>
            <label>
              Tanggal diterima
              <input name="transactionDate" type="date" required defaultValue={editing?.date || today} />
            </label>
            <label>
              Nominal
              <input name="amount" type="number" min="1" max="1000000000000000" step="1" required defaultValue={editing ? Math.abs(editing.amount) : undefined} placeholder="0" />
            </label>
            <label>
              Masuk ke rekening
              <select name="accountId" required defaultValue={editing?.accountId || settings.defaultAccountId}>
                <option value="" disabled>
                  Pilih rekening
                </option>
                {cashAccounts.map((account) => (
                  <option value={account.id} key={account.id}>
                    {account.name} — {formatIDR(account.balance)}
                  </option>
                ))}
              </select>
            </label>
            <label className="span-2">
              Deskripsi
              <input name="description" required minLength={3} maxLength={240} defaultValue={editing?.description || ''} placeholder="Contoh: Pembayaran jasa pengelolaan iklan Agustus" />
            </label>
            <label>
              Nama pelanggan/pengirim <span className="optional-label">Opsional</span>
              <input name="counterparty" maxLength={120} defaultValue={editing?.counterparty || ''} placeholder="Nama perusahaan atau pengirim" />
            </label>
            <label>
              Metode
              <select name="paymentMethod" defaultValue={editing?.paymentMethod || 'transfer'}>
                <option value="transfer">Transfer</option>
                <option value="ewallet">E-Wallet</option>
                <option value="cash">Cash</option>
              </select>
            </label>
            <label>
              Link bukti transaksi <span className="optional-label">Opsional</span>
              <input name="proofUrl" type="url" maxLength={500} defaultValue={editing?.proofUrl || ''} placeholder="https://..." />
            </label>
            <div className="income-journal-note span-2">
              <BanknoteArrowDown size={20} />
              <div>
                <strong>Saldo selalu seimbang</strong>
                <span>Rekening tujuan bertambah, sementara akun Pendapatan, Modal, Pinjaman, atau Refund menjadi penyeimbang otomatis.</span>
              </div>
            </div>
            <div className="modal-actions span-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setModal(false)
                  setEditing(null)
                  setError('')
                }}
              >
                Batal
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Menyimpan…' : editing ? 'Simpan perubahan' : 'Simpan dana masuk'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {expenseModal && (
        <Modal
          title={editing ? 'Edit pengeluaran' : 'Catat pengeluaran'}
          description={editing ? 'Data lama digantikan di daftar dan rekap; jejak audit tetap tersimpan.' : 'Gunakan untuk biaya yang tidak melalui pengajuan belanja.'}
          onClose={() => {
            setExpenseModal(false)
            setEditing(null)
            setError('')
          }}
        >
          <form className="form-grid" action={createExpense}>
            {error && <div className="auth-error span-2">{error}</div>}
            <label>
              Tanggal pembayaran
              <input name="transactionDate" type="date" required defaultValue={editing?.date || today} />
            </label>
            <label>
              Nominal
              <input name="amount" type="number" min="1" step="1" required value={expenseAmount || ''} onChange={(event) => setExpenseAmount(Number(event.target.value))} />
            </label>
            <label>
              Rekening
              <select name="accountId" required defaultValue={editing?.accountId || ''}>
                <option value="" disabled>
                  Pilih rekening
                </option>
                {cashAccounts.map((account) => (
                  <option value={account.id} key={account.id}>
                    {account.name} — {formatIDR(account.balance)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Kategori
              <select name="category" value={expenseCategory} onChange={(event) => setExpenseCategory(event.target.value)}>
                <option>Utilities & Langganan</option>
                <option>Konsumsi & Pantry</option>
                <option>Kebersihan & Perlengkapan</option>
                <option>Kegiatan</option>
                <option>Personalia</option>
                <option>Lain-Lain</option>
              </select>
            </label>
            <label className="span-2">
              Ambil dari rincian RAB <span className="optional-label">Opsional</span>
              <select value={expenseBudgetItemValue} onChange={(event) => selectBudgetItem(event.target.value)}>
                <option value="">Pilih item untuk mengisi otomatis</option>
                {budgetCategories.filter((category) => category.lineItems.length).map((category) => (
                  <optgroup label={category.name} key={category.id}>
                    {category.lineItems.map((item, index) => (
                      <option value={`${category.id}:${index}`} key={`${category.id}-${index}`}>{item.name} — {item.quantity.toLocaleString('id-ID')} × {formatIDR(item.unitPrice)} = {formatIDR(item.quantity * item.unitPrice)}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <label className="span-2">
              Pos RAB
              <select name="budgetCategoryId" value={expenseBudgetCategoryId} onChange={(event) => { setExpenseBudgetCategoryId(event.target.value); setExpenseBudgetItemName('') }}>
                <option value="">Di luar RAB</option>
                {budgetCategories.map((category) => (
                  <option value={category.id} key={category.id}>
                    {category.name} — sisa {formatIDR(category.plannedAmount - category.actual - category.committedAmount)}
                  </option>
                ))}
              </select>
            </label>
            <label className="span-2">
              Deskripsi
              <input name="description" required minLength={3} maxLength={240} value={expenseDescription} onChange={(event) => setExpenseDescription(event.target.value)} />
            </label>
            <label>
              PIC
              <input name="counterparty" maxLength={120} defaultValue={editing?.counterparty || ''} />
            </label>
            <label>
              Metode
              <select name="paymentMethod" defaultValue={editing?.paymentMethod || 'transfer'}>
                <option value="transfer">Transfer</option>
                <option value="ewallet">E-Wallet</option>
                <option value="cash">Cash</option>
              </select>
            </label>
            <label className="span-2">
              Link bukti transaksi <span className="optional-label">Opsional</span>
              <input name="proofUrl" type="url" maxLength={500} defaultValue={editing?.proofUrl || ''} placeholder="https://..." />
            </label>
            <label className="span-2">
              Alasan override RAB <span className="optional-label">Jika diperlukan</span>
              <input name="overrideReason" maxLength={500} />
            </label>
            <div className="income-journal-note span-2">
              <ArrowUpRight size={20} />
              <div>
                <strong>Saldo berkurang otomatis</strong>
                <span>Rekening pembayaran dikreditkan dan akun pengeluaran menjadi penyeimbang.</span>
              </div>
            </div>
            <div className="modal-actions span-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setExpenseModal(false)
                  setEditing(null)
                }}
              >
                Batal
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Menyimpan…' : editing ? 'Simpan perubahan' : 'Simpan pengeluaran'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  )
}
