import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowDownLeft, ArrowUpRight, BanknoteArrowDown, Check, Download, Filter, Plus, RotateCcw, Search, Trash2 } from 'lucide-react'
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
  const [reversal, setReversal] = useState<Transaction | null>(null)
  const [budgetCategories, setBudgetCategories] = useState<BudgetCategory[]>([])
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
      setModal(true)
    }
    if (action === 'expense' && canPost) {
      setError('')
      setExpenseModal(true)
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
          })),
        ),
      )
  }, [])
  const filtered = useMemo(() => items.filter((item) => `${item.description} ${item.reference} ${item.category} ${item.counterparty || ''}`.toLowerCase().includes(query.toLowerCase()) && (kind === 'all' || item.kind === kind)), [items, kind, query])
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
      const response = await fetch('/api/income', {
        method: 'POST',
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
        amount: Number(formData.get('amount')),
        accountId: String(formData.get('accountId')),
        description: String(formData.get('description')).trim(),
        category: String(formData.get('category')),
        budgetCategoryId: String(formData.get('budgetCategoryId')) || undefined,
        counterparty: String(formData.get('counterparty')).trim() || undefined,
        paymentMethod: String(formData.get('paymentMethod')),
        proofUrl: String(formData.get('proofUrl')).trim() || undefined,
        overrideReason: String(formData.get('overrideReason')).trim() || undefined,
      }
      const response = await fetch('/api/expenses', {
        method: 'POST',
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
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Terjadi kesalahan')
    } finally {
      setSaving(false)
    }
  }
  async function reverseTransaction(formData: FormData) {
    if (!reversal) return
    setSaving(true)
    setError('')
    try {
      const response = await fetch(`/api/transactions/${reversal.id}/reverse`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactionDate: String(formData.get('transactionDate')),
          reason: String(formData.get('reason')).trim(),
        }),
      })
      const body = (await response.json().catch(() => ({}))) as {
        error?: string
      }
      if (!response.ok) throw new Error(body.error || 'Koreksi belum dapat disimpan')
      await refresh()
      setReversal(null)
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
                  setExpenseModal(true)
                }}
              >
                <ArrowUpRight size={16} /> Catat pengeluaran
              </Button>
            )}
            <Button
              onClick={() => {
                setError('')
                setModal(true)
              }}
            >
              <Plus size={16} /> Catat dana masuk
            </Button>
          </>
        }
      />
      {error && !modal && !expenseModal && !reversal && (
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
                          <button
                            className="reject"
                            aria-label={`Koreksi ${trx.description}`}
                            onClick={() => {
                              setError('')
                              setReversal(trx)
                            }}
                          >
                            <RotateCcw size={14} />
                          </button>
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
          title="Catat dana masuk"
          description="Dana dicatat ke rekening perusahaan dengan jurnal berpasangan."
          onClose={() => {
            setModal(false)
            setError('')
          }}
        >
          <form className="form-grid" action={createIncome}>
            {error && <div className="auth-error span-2">{error}</div>}
            <label>
              Sumber dana
              <select name="sourceType" defaultValue="service_income">
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
              <input name="transactionDate" type="date" required defaultValue={today} />
            </label>
            <label>
              Nominal
              <input name="amount" type="number" min="1" max="1000000000000000" step="1" required placeholder="0" />
            </label>
            <label>
              Masuk ke rekening
              <select name="accountId" required defaultValue={settings.defaultAccountId}>
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
              <input name="description" required minLength={3} maxLength={240} placeholder="Contoh: Pembayaran jasa pengelolaan iklan Agustus" />
            </label>
            <label>
              Nama pelanggan/pengirim <span className="optional-label">Opsional</span>
              <input name="counterparty" maxLength={120} placeholder="Nama perusahaan atau pengirim" />
            </label>
            <label>
              Metode
              <select name="paymentMethod" defaultValue="transfer">
                <option value="transfer">Transfer</option>
                <option value="ewallet">E-Wallet</option>
                <option value="cash">Cash</option>
              </select>
            </label>
            <label>
              Link bukti transaksi <span className="optional-label">Opsional</span>
              <input name="proofUrl" type="url" maxLength={500} placeholder="https://..." />
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
                  setError('')
                }}
              >
                Batal
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Menyimpan…' : 'Simpan dana masuk'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {expenseModal && (
        <Modal
          title="Catat pengeluaran"
          description="Gunakan untuk biaya yang tidak melalui pengajuan belanja."
          onClose={() => {
            setExpenseModal(false)
            setError('')
          }}
        >
          <form className="form-grid" action={createExpense}>
            {error && <div className="auth-error span-2">{error}</div>}
            <label>
              Tanggal pembayaran
              <input name="transactionDate" type="date" required defaultValue={today} />
            </label>
            <label>
              Nominal
              <input name="amount" type="number" min="1" step="1" required />
            </label>
            <label>
              Rekening
              <select name="accountId" required defaultValue="">
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
              <select name="category" defaultValue="Utilities & Langganan">
                <option>Utilities & Langganan</option>
                <option>Konsumsi & Pantry</option>
                <option>Kebersihan & Perlengkapan</option>
                <option>Kegiatan</option>
                <option>Personalia</option>
                <option>Lain-Lain</option>
              </select>
            </label>
            <label className="span-2">
              Pos RAB
              <select name="budgetCategoryId">
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
              <input name="description" required minLength={3} maxLength={240} />
            </label>
            <label>
              PIC
              <input name="counterparty" maxLength={120} />
            </label>
            <label>
              Metode
              <select name="paymentMethod" defaultValue="transfer">
                <option value="transfer">Transfer</option>
                <option value="ewallet">E-Wallet</option>
                <option value="cash">Cash</option>
              </select>
            </label>
            <label className="span-2">
              Link bukti transaksi <span className="optional-label">Opsional</span>
              <input name="proofUrl" type="url" maxLength={500} placeholder="https://..." />
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
              <Button variant="secondary" onClick={() => setExpenseModal(false)}>
                Batal
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Menyimpan…' : 'Simpan pengeluaran'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {reversal && (
        <Modal
          title="Koreksi dengan reversal"
          description={reversal.description}
          onClose={() => {
            setReversal(null)
            setError('')
          }}
        >
          <form className="form-grid" action={reverseTransaction}>
            {error && <div className="auth-error span-2">{error}</div>}
            <label className="span-2">
              Tanggal koreksi
              <input name="transactionDate" type="date" required defaultValue={today} />
            </label>
            <label className="span-2">
              Alasan koreksi
              <textarea name="reason" required minLength={5} maxLength={500} />
            </label>
            <div className="form-note span-2">Transaksi asli tidak dihapus. Sistem membuat jurnal kebalikan agar jejak audit tetap lengkap.</div>
            <div className="modal-actions span-2">
              <Button variant="secondary" onClick={() => setReversal(null)}>
                Batal
              </Button>
              <Button type="submit" variant="danger" disabled={saving}>
                {saving ? 'Menyimpan…' : 'Buat reversal'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  )
}
