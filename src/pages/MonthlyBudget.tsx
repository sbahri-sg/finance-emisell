import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowDownToLine, CheckCircle2, ChevronDown, Copy, Edit3, FolderPlus, PiggyBank, Plus, ReceiptText, WalletCards } from 'lucide-react'
import { Badge, Button, Card, Modal, PageHeader } from '../components/ui'
import { formatIDR } from '../lib/format'
import type { BudgetCategory, BudgetCategoryType, BudgetPeriod } from '../types'
import { useFinance } from '../lib/FinanceContext'

type BudgetResponse = {
  budget: BudgetPeriod | null
  categories: BudgetCategory[]
}
type EditingCategory = BudgetCategory | null

const categoryTypeLabel: Record<BudgetCategoryType, string> = {
  fixed: 'Tetap',
  variable: 'Variabel',
  emergency: 'Darurat',
  investment: 'Investasi/aset',
}
const initialMonth = new Date().toISOString().slice(0, 7)

function monthLabel(month: string) {
  return new Intl.DateTimeFormat('id-ID', {
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${month}-01T12:00:00`))
}
function numberValue(value: unknown) {
  return Number(value) || 0
}

export function MonthlyBudget() {
  const { user } = useFinance()
  const [month, setMonth] = useState(initialMonth)
  const [data, setData] = useState<BudgetResponse>({
    budget: null,
    categories: [],
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [categoryModal, setCategoryModal] = useState(false)
  const [editing, setEditing] = useState<EditingCategory>(null)
  const [expandedCategoryId, setExpandedCategoryId] = useState<string | null>(null)

  const loadBudget = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`/api/budgets?month=${encodeURIComponent(month)}`, { credentials: 'include' })
      if (!response.ok) throw new Error('RAB belum dapat dimuat')
      const raw = (await response.json()) as BudgetResponse
      setData({
        budget: raw.budget,
        categories: (raw.categories || []).map((category) => ({
          ...category,
          plannedAmount: numberValue(category.plannedAmount),
          actual: numberValue(category.actual),
          pendingAmount: numberValue(category.pendingAmount),
          committedAmount: numberValue(category.committedAmount),
        })),
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Terjadi kesalahan')
    } finally {
      setLoading(false)
    }
  }, [month])
  useEffect(() => {
    void loadBudget()
  }, [loadBudget])

  const summary = useMemo(
    () =>
      data.categories.reduce(
        (result, category) => ({
          planned: result.planned + category.plannedAmount,
          actual: result.actual + category.actual,
          pending: result.pending + category.pendingAmount,
          committed: result.committed + category.committedAmount,
        }),
        { planned: 0, actual: 0, pending: 0, committed: 0 },
      ),
    [data.categories],
  )
  const available = summary.planned - summary.actual - summary.committed
  const totalUsed = summary.actual + summary.committed
  const budgetUsage = summary.planned ? Math.round((totalUsed / summary.planned) * 100) : 0
  const warningCategories = data.categories.filter((category) => category.plannedAmount > 0 && (category.actual + category.committedAmount) / category.plannedAmount >= 0.9)

  async function request(url: string, options: RequestInit) {
    setSaving(true)
    setError('')
    try {
      const response = await fetch(url, {
        ...options,
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers || {}),
        },
      })
      const body = (await response.json().catch(() => ({}))) as {
        error?: string
      }
      if (!response.ok) throw new Error(body.error || 'Perubahan belum dapat disimpan')
      await loadBudget()
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Terjadi kesalahan')
      return false
    } finally {
      setSaving(false)
    }
  }
  async function createBudget() {
    await request('/api/budgets', {
      method: 'POST',
      body: JSON.stringify({ month }),
    })
  }
  async function copyPrevious() {
    await request('/api/budgets/copy-previous', {
      method: 'POST',
      body: JSON.stringify({ month }),
    })
  }
  async function changeStatus() {
    if (!data.budget) return
    const next = data.budget.status === 'closed' ? 'active' : 'closed'
    if (next === 'closed' && !window.confirm('Tutup RAB bulan ini? Transaksi pada periode tertutup tidak dapat ditambah atau diubah.')) return
    await request(`/api/budgets/${data.budget.id}/status`, {
      method: 'POST',
      body: JSON.stringify({ status: next }),
    })
  }
  function openCategory(category: EditingCategory) {
    setEditing(category)
    setCategoryModal(true)
  }
  async function saveCategory(formData: FormData) {
    if (!data.budget) return
    const payload = {
      name: String(formData.get('name')).trim(),
      expenseCategory: String(formData.get('expenseCategory')),
      details: String(formData.get('details'))
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
      categoryType: String(formData.get('categoryType')),
      plannedAmount: Number(formData.get('plannedAmount')),
      color: String(formData.get('color')),
    }
    const ok = await request(editing ? `/api/budget-categories/${editing.id}` : `/api/budgets/${data.budget.id}/categories`, { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(payload) })
    if (ok) {
      setCategoryModal(false)
      setEditing(null)
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="PERENCANAAN"
        title="Anggaran bulanan (RAB)"
        description="Rencanakan pengeluaran dan pantau realisasi tanpa kehilangan kendali atas saldo perusahaan."
        action={
          <div className="budget-month-control">
            <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} aria-label="Pilih bulan RAB" />
            {data.budget && ['owner', 'admin'].includes(user?.role || '') && (
              <Button variant="secondary" onClick={changeStatus}>
                {data.budget.status === 'closed' ? 'Buka kembali' : 'Tutup periode'}
              </Button>
            )}
            {data.budget && data.budget.status !== 'closed' && (
              <Button onClick={() => openCategory(null)}>
                <Plus size={16} /> Tambah pos
              </Button>
            )}
          </div>
        }
      />

      {error && (
        <div className="budget-alert error">
          <AlertTriangle size={18} />
          <span>{error}</span>
          <button onClick={() => setError('')}>Tutup</button>
        </div>
      )}
      {loading ? (
        <Card className="budget-loading">Memuat anggaran…</Card>
      ) : !data.budget ? (
        <Card className="budget-onboarding">
          <span className="budget-onboarding-icon">
            <PiggyBank size={34} />
          </span>
          <h2>Belum ada RAB untuk {monthLabel(month)}</h2>
          <p>Buat struktur baru dengan pos dasar, atau gunakan nominal dari bulan sebelumnya.</p>
          <div>
            <Button onClick={createBudget} disabled={saving}>
              <FolderPlus size={16} /> Buat RAB baru
            </Button>
            <Button variant="secondary" onClick={copyPrevious} disabled={saving}>
              <Copy size={16} /> Salin bulan lalu
            </Button>
          </div>
          <small>RAB baru dibuat dengan nominal Rp0 sehingga aman untuk disesuaikan terlebih dahulu.</small>
        </Card>
      ) : (
        <>
          <div className="budget-hero">
            <div>
              <span>RAB {monthLabel(month)}</span>
              <strong>{formatIDR(summary.planned)}</strong>
              <small>
                <CheckCircle2 size={14} /> Status {data.budget.status === 'closed' ? 'ditutup' : 'aktif'} · {data.categories.length} pos anggaran
              </small>
            </div>
            <div className="budget-hero-progress">
              <span>
                Terpakai & dialokasikan <b>{budgetUsage}%</b>
              </span>
              <div>
                <i style={{ width: `${Math.min(100, budgetUsage)}%` }} />
              </div>
              <small>{formatIDR(totalUsed)} dari total anggaran</small>
            </div>
          </div>

          <div className="mini-stats four budget-stats">
            <Card>
              <span>Total anggaran</span>
              <strong>{formatIDR(summary.planned)}</strong>
              <small>{data.categories.length} pos aktif</small>
            </Card>
            <Card>
              <span>Realisasi transaksi</span>
              <strong>{formatIDR(summary.actual)}</strong>
              <small>Pengeluaran yang sudah diposting</small>
            </Card>
            <Card>
              <span>Pengajuan berjalan</span>
              <strong>{formatIDR(summary.pending + summary.committed)}</strong>
              <small>{formatIDR(summary.committed)} sudah disetujui</small>
            </Card>
            <Card>
              <span>Sisa tersedia</span>
              <strong className={available < 0 ? 'negative' : 'positive'}>{formatIDR(available)}</strong>
              <small>Setelah realisasi & persetujuan</small>
            </Card>
          </div>

          {warningCategories.length > 0 && (
            <div className="budget-alert warning">
              <AlertTriangle size={18} />
              <span>
                <strong>{warningCategories.length} pos mendekati batas.</strong> Periksa pengeluaran sebelum menyetujui pengajuan baru.
              </span>
            </div>
          )}

          <Card className="data-card budget-card">
            <div className="card-heading">
              <div>
                <h2>Rincian pos anggaran</h2>
                <p>Realisasi berasal dari transaksi, sedangkan alokasi berasal dari pengajuan yang disetujui.</p>
              </div>
              <Badge tone="info">{monthLabel(month)}</Badge>
            </div>
            <div className="budget-category-list">
              {data.categories.map((category) => {
                const used = category.actual + category.committedAmount
                const remaining = category.plannedAmount - used
                const percent = category.plannedAmount ? Math.round((used / category.plannedAmount) * 100) : 0
                const tone = percent >= 100 ? 'over' : percent >= 90 ? 'danger' : percent >= 70 ? 'warning' : 'safe'
                return (
                  <article className="budget-category-row" key={category.id}>
                    <div className="budget-category-main">
                      <span
                        className="budget-category-icon"
                        style={{
                          background: `${category.color}18`,
                          color: category.color,
                        }}
                      >
                        <WalletCards size={19} />
                      </span>
                      <div>
                        <strong>{category.name}</strong>
                        <span>
                          {category.expenseCategory || 'Lain-Lain'} · {categoryTypeLabel[category.categoryType]}
                          {!!category.details?.length && <> · {category.details.length} rincian</>}
                          {category.pendingAmount > 0 && (
                            <>
                              {' '}
                              · <b>{formatIDR(category.pendingAmount)} menunggu approval</b>
                            </>
                          )}
                        </span>
                      </div>
                    </div>
                    <div className="budget-value">
                      <span>Anggaran</span>
                      <strong>{formatIDR(category.plannedAmount)}</strong>
                    </div>
                    <div className="budget-value">
                      <span>Realisasi</span>
                      <strong>{formatIDR(category.actual)}</strong>
                    </div>
                    <div className="budget-value">
                      <span>Dialokasikan</span>
                      <strong>{formatIDR(category.committedAmount)}</strong>
                    </div>
                    <div className="budget-progress-cell">
                      <div>
                        <span>
                          Sisa <strong className={remaining < 0 ? 'negative' : ''}>{formatIDR(remaining)}</strong>
                        </span>
                        <b>{percent}%</b>
                      </div>
                      <div className={`budget-progress ${tone}`}>
                        <i
                          style={{
                            width: `${Math.min(100, percent)}%`,
                            background: category.color,
                          }}
                        />
                      </div>
                    </div>
                    <div className="budget-row-actions">
                      {!!category.details?.length && (
                        <button className={`budget-edit ${expandedCategoryId === category.id ? 'active' : ''}`} onClick={() => setExpandedCategoryId((current) => (current === category.id ? null : category.id))} aria-label={`Lihat rincian ${category.name}`} aria-expanded={expandedCategoryId === category.id}>
                          <ChevronDown size={16} />
                        </button>
                      )}
                      {data.budget?.status !== 'closed' && (
                        <button className="budget-edit" onClick={() => openCategory(category)} aria-label={`Edit ${category.name}`}>
                          <Edit3 size={16} />
                        </button>
                      )}
                    </div>
                    {expandedCategoryId === category.id && !!category.details?.length && (
                      <div className="budget-detail-dropdown">
                        <strong>Rincian {category.name}</strong>
                        <div>
                          {category.details.map((detail) => (
                            <span key={detail}>{detail}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </article>
                )
              })}
              {!data.categories.length && (
                <div className="dashboard-empty">
                  <ReceiptText size={25} />
                  <strong>Belum ada pos anggaran</strong>
                  <span>Tambahkan pos pertama untuk mulai menyusun RAB.</span>
                </div>
              )}
            </div>
          </Card>

          <Card className="budget-footnote">
            <ArrowDownToLine size={20} />
            <div>
              <strong>Cara perhitungan sisa tersedia</strong>
              <span>Anggaran dikurangi transaksi aktual dan pengajuan yang sudah disetujui atau sedang dibeli. Pengajuan yang masih menunggu approval ditampilkan terpisah.</span>
            </div>
          </Card>
        </>
      )}

      {categoryModal && (
        <Modal
          title={editing ? 'Edit pos anggaran' : 'Tambah pos anggaran'}
          description={`RAB ${monthLabel(month)}`}
          onClose={() => {
            setCategoryModal(false)
            setEditing(null)
          }}
        >
          <form className="form-grid" action={saveCategory}>
            <label className="span-2">
              Nama pos
              <input name="name" required maxLength={80} defaultValue={editing?.name || ''} placeholder="Contoh: Perjalanan dinas" />
            </label>
            <label>
              Kategori pengeluaran
              <select name="expenseCategory" defaultValue={editing?.expenseCategory || 'Lain-Lain'}>
                <option>Utilities & Langganan</option>
                <option>Konsumsi & Pantry</option>
                <option>Kebersihan & Perlengkapan</option>
                <option>Kegiatan</option>
                <option>Personalia</option>
                <option>Lain-Lain</option>
              </select>
            </label>
            <label>
              Jenis
              <select name="categoryType" defaultValue={editing?.categoryType || 'variable'}>
                <option value="fixed">Tetap</option>
                <option value="variable">Variabel</option>
                <option value="emergency">Darurat</option>
                <option value="investment">Investasi/aset</option>
              </select>
            </label>
            <label className="span-2">
              Rincian pos <span className="optional-label">Pisahkan dengan koma</span>
              <input name="details" maxLength={1000} defaultValue={editing?.details?.join(', ') || ''} placeholder="Contoh: Galon, ATK, tinta printer" />
            </label>
            <label>
              Warna indikator
              <input className="color-input" name="color" type="color" defaultValue={editing?.color || '#2f7168'} />
            </label>
            <label className="span-2">
              Nominal anggaran
              <input name="plannedAmount" type="number" min="0" step="1" required defaultValue={editing?.plannedAmount || 0} />
            </label>
            <div className="form-note span-2">Mengubah nominal tidak mengubah saldo rekening. Semua perubahan dicatat dalam audit log.</div>
            <div className="modal-actions span-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setCategoryModal(false)
                  setEditing(null)
                }}
              >
                Batal
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Menyimpan…' : 'Simpan pos'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  )
}
