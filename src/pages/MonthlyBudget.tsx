import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowDownToLine, CheckCircle2, ChevronDown, Copy, Edit3, FolderPlus, PiggyBank, Plus, ReceiptText, Trash2, WalletCards } from 'lucide-react'
import { Badge, Button, Card, Modal, PageHeader } from '../components/ui'
import { formatIDR } from '../lib/format'
import type { BudgetCategory, BudgetCategoryType, BudgetLineItem, BudgetModel, BudgetPeriod, ExpenseCategoryLabel } from '../types'
import { useFinance } from '../lib/FinanceContext'

type BudgetResponse = {
  budget: BudgetPeriod | null
  categories: BudgetCategory[]
}
type EditingCategory = BudgetCategory | null
type DeleteTarget =
  | { type: 'category'; category: BudgetCategory }
  | { type: 'item'; category: BudgetCategory; item: BudgetLineItem; itemIndex: number }

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
  const [budgetModel, setBudgetModel] = useState<BudgetModel>('fixed')
  const [lineItems, setLineItems] = useState<BudgetLineItem[]>([])
  const [fixedAmount, setFixedAmount] = useState(0)
  const [expenseCategories, setExpenseCategories] = useState<ExpenseCategoryLabel[]>([])
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)

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
          budgetModel: category.budgetModel || (category.details?.length ? 'multi_item' : 'fixed'),
          lineItems: (category.lineItems || []).map((item) => ({ id: item.id, name: item.name, quantity: numberValue(item.quantity), unitPrice: numberValue(item.unitPrice), purchasedQuantity: numberValue(item.purchasedQuantity), remainingQuantity: numberValue(item.remainingQuantity) })),
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
  useEffect(() => {
    void fetch('/api/expense-categories', { credentials: 'include' }).then((response) => response.ok ? response.json() : { categories: [] }).then((raw: { categories?: ExpenseCategoryLabel[] }) => setExpenseCategories(raw.categories || []))
  }, [])

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
    setBudgetModel(category?.budgetModel || 'fixed')
    setLineItems(category?.lineItems?.length ? category.lineItems.map((item) => ({ ...item })) : [])
    setFixedAmount(category?.plannedAmount || 0)
    setCategoryModal(true)
  }
  function updateLineItem(index: number, field: keyof BudgetLineItem, value: string) {
    setLineItems((current) =>
      current.map((item, itemIndex) => {
        if (itemIndex !== index) return item
        if (field === 'name') return { ...item, name: value }
        if (field === 'quantity') return { ...item, quantity: Math.max(1, Math.trunc(Number(value) || 1)) }
        return { ...item, unitPrice: Math.max(0, Number(value) || 0) }
      }),
    )
  }
  const lineItemsTotal = lineItems.reduce((sum, item) => sum + numberValue(item.quantity) * numberValue(item.unitPrice), 0)
  function askRemoveSavedLineItem(category: BudgetCategory, item: BudgetLineItem, itemIndex: number) {
    if (numberValue(item.purchasedQuantity) > 0) {
      setError(`${item.name} sudah pernah dibeli. Item dipertahankan agar histori transaksi tetap akurat.`)
      return
    }
    if (category.lineItems.length <= 1) {
      setError('Item terakhir tidak dapat dihapus. Ubah model pos menjadi “Tetap” jika rincian item tidak lagi diperlukan.')
      return
    }
    setDeleteTarget({ type: 'item', category, item, itemIndex })
  }
  function askRemoveCategory(category: BudgetCategory) {
    if (!category.canDelete) {
      setError(`${category.name} sudah dipakai oleh transaksi atau pengajuan. Pos dipertahankan agar histori tetap akurat.`)
      return
    }
    setDeleteTarget({ type: 'category', category })
  }
  async function confirmDelete() {
    if (!deleteTarget) return
    if (deleteTarget.type === 'category') {
      const ok = await request(`/api/budget-categories/${deleteTarget.category.id}`, { method: 'DELETE' })
      if (ok) {
        setExpandedCategoryId((current) => current === deleteTarget.category.id ? null : current)
        setDeleteTarget(null)
      }
      return
    }
    const { category, itemIndex } = deleteTarget
    const nextItems = category.lineItems.filter((_, index) => index !== itemIndex)
    const ok = await request(`/api/budget-categories/${category.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        name: category.name,
        expenseCategory: category.expenseCategory,
        details: nextItems.map((candidate) => candidate.name),
        budgetModel: category.budgetModel,
        lineItems: nextItems.map((candidate) => ({ id: candidate.id, name: candidate.name, quantity: candidate.quantity, unitPrice: candidate.unitPrice })),
        categoryType: category.categoryType,
        plannedAmount: nextItems.reduce((sum, candidate) => sum + candidate.quantity * candidate.unitPrice, 0),
        color: category.color,
      }),
    })
    if (ok) setDeleteTarget(null)
  }
  async function saveCategory(formData: FormData) {
    if (!data.budget) return
    const payload = {
      name: String(formData.get('name')).trim(),
      expenseCategory: String(formData.get('expenseCategory')),
      details: budgetModel === 'multi_item' ? lineItems.map((item) => item.name.trim()).filter(Boolean) : [],
      budgetModel,
      lineItems: budgetModel === 'multi_item' ? lineItems.map((item) => ({ id: item.id, name: item.name.trim(), quantity: numberValue(item.quantity), unitPrice: numberValue(item.unitPrice) })) : [],
      categoryType: String(formData.get('categoryType')),
      plannedAmount: budgetModel === 'multi_item' ? lineItemsTotal : fixedAmount,
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
                          {' '}· {category.budgetModel === 'multi_item' ? `${category.lineItems.length} item` : 'Model tetap'}
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
                      {!!category.lineItems?.length && (
                        <button className={`budget-edit ${expandedCategoryId === category.id ? 'active' : ''}`} onClick={() => setExpandedCategoryId((current) => (current === category.id ? null : category.id))} aria-label={`Lihat rincian ${category.name}`} aria-expanded={expandedCategoryId === category.id}>
                          <ChevronDown size={16} />
                        </button>
                      )}
                      {data.budget?.status !== 'closed' && (
                        <>
                          <button className="budget-edit" onClick={() => openCategory(category)} aria-label={`Edit ${category.name}`}>
                            <Edit3 size={16} />
                          </button>
                          <button
                            className="budget-edit budget-category-delete"
                            onClick={() => askRemoveCategory(category)}
                            aria-label={`Hapus pos ${category.name}`}
                            title={category.canDelete ? `Hapus pos ${category.name}` : 'Tidak dapat dihapus karena sudah dipakai transaksi atau pengajuan'}
                            disabled={saving || !category.canDelete}
                          >
                            <Trash2 size={16} />
                          </button>
                        </>
                      )}
                    </div>
                    {expandedCategoryId === category.id && !!category.lineItems?.length && (
                      <div className="budget-detail-dropdown">
                        <strong>Rincian {category.name}</strong>
                        <div className="budget-detail-table">
                          {category.lineItems.map((item, index) => (
                            <div key={item.id || `${item.name}-${index}`}>
                              <span>{item.name}</span>
                              <span>{(item.purchasedQuantity || 0).toLocaleString('id-ID')} dibeli · sisa {(item.remainingQuantity ?? item.quantity).toLocaleString('id-ID')}</span>
                              <strong>{item.quantity.toLocaleString('id-ID')} × {formatIDR(item.unitPrice)}</strong>
                              {data.budget?.status !== 'closed' && (
                                <button
                                  type="button"
                                  className="budget-detail-delete"
                                  aria-label={`Hapus ${item.name}`}
                                  title={numberValue(item.purchasedQuantity) > 0 ? 'Tidak dapat dihapus karena sudah dipakai transaksi' : `Hapus ${item.name}`}
                                  disabled={saving || numberValue(item.purchasedQuantity) > 0}
                                  onClick={() => askRemoveSavedLineItem(category, item, index)}
                                >
                                  <Trash2 size={15} />
                                </button>
                              )}
                            </div>
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
              <select name="expenseCategory" defaultValue={editing?.expenseCategory || expenseCategories[0]?.name}>
                {editing?.expenseCategory && !expenseCategories.some((category) => category.name === editing.expenseCategory) && <option value={editing.expenseCategory}>{editing.expenseCategory} — nonaktif</option>}
                {expenseCategories.map((category) => <option value={category.name} key={category.id}>{category.name}</option>)}
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
            <label>
              Model anggaran
              <select value={budgetModel} onChange={(event) => setBudgetModel(event.target.value as BudgetModel)}>
                <option value="fixed">Tetap — satu nominal</option>
                <option value="multi_item">Multi-item — rincian otomatis</option>
              </select>
            </label>
            <label>
              Warna indikator
              <input className="color-input" name="color" type="color" defaultValue={editing?.color || '#2f7168'} />
            </label>
            {budgetModel === 'fixed' ? (
              <label className="span-2">
                Nominal anggaran
                <input name="plannedAmount" type="number" min="0" step="1" required value={fixedAmount} onChange={(event) => setFixedAmount(Number(event.target.value))} />
              </label>
            ) : (
              <div className="budget-line-editor span-2">
                <div className="budget-line-heading">
                  <div><strong>Rincian item</strong><span>Kuantitas × harga satuan dihitung otomatis.</span></div>
                  <button type="button" onClick={() => setLineItems((current) => [...current, { name: '', quantity: 1, unitPrice: 0 }])}><Plus size={15} /> Tambah item</button>
                </div>
                <div className="budget-line-labels"><span>Nama item</span><span>Qty</span><span>Harga satuan</span><span>Total</span><span /></div>
                {lineItems.map((item, index) => (
                  <div className="budget-line-row" key={index}>
                    <input required minLength={2} maxLength={80} value={item.name} onChange={(event) => updateLineItem(index, 'name', event.target.value)} placeholder="Contoh: Galon" />
                    <input required type="number" min="1" step="1" inputMode="numeric" value={item.quantity} onWheel={(event) => event.currentTarget.blur()} onChange={(event) => updateLineItem(index, 'quantity', event.target.value)} />
                    <input required type="number" min="0" step="1" value={item.unitPrice} onChange={(event) => updateLineItem(index, 'unitPrice', event.target.value)} />
                    <strong>{formatIDR(item.quantity * item.unitPrice)}</strong>
                    <button
                      type="button"
                      aria-label={`Hapus ${item.name || 'item'}`}
                      title={numberValue(item.purchasedQuantity) > 0 ? 'Tidak dapat dihapus karena sudah dipakai transaksi' : `Hapus ${item.name || 'item'}`}
                      disabled={numberValue(item.purchasedQuantity) > 0}
                      onClick={() => setLineItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
                {!lineItems.length && <div className="budget-line-empty">Belum ada item. Klik “Tambah item” untuk membuat rincian RAB.</div>}
                <div className="budget-line-total"><span>Total anggaran</span><strong>{formatIDR(lineItemsTotal)}</strong></div>
              </div>
            )}
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

      {deleteTarget && (
        <Modal
          title={deleteTarget.type === 'category' ? 'Hapus pos anggaran?' : 'Hapus rincian item?'}
          description="Konfirmasi diperlukan sebelum data dihapus"
          onClose={() => !saving && setDeleteTarget(null)}
        >
          <div className="delete-confirmation">
            <span className="delete-confirmation-icon"><Trash2 size={25} /></span>
            <div>
              <strong>{deleteTarget.type === 'category' ? deleteTarget.category.name : deleteTarget.item.name}</strong>
              <p>
                {deleteTarget.type === 'category'
                  ? `Pos ini akan dikeluarkan dari RAB ${monthLabel(month)}${deleteTarget.category.lineItems.length ? ` beserta ${deleteTarget.category.lineItems.length} rincian item` : ''}. Total anggaran akan dihitung ulang otomatis.`
                  : `Item ini akan dihapus dari pos ${deleteTarget.category.name}. Total pos dan total RAB akan dihitung ulang otomatis.`}
              </p>
            </div>
          </div>
          <div className="delete-confirmation-note">
            <AlertTriangle size={17} />
            <span>{deleteTarget.type === 'category' ? 'Histori transaksi yang sudah dibatalkan tetap disimpan untuk audit.' : 'Pastikan item ini memang tidak lagi diperlukan dalam rencana belanja.'}</span>
          </div>
          <div className="modal-actions delete-confirmation-actions">
            <Button variant="secondary" onClick={() => setDeleteTarget(null)} disabled={saving}>Batal</Button>
            <Button variant="danger" onClick={() => void confirmDelete()} disabled={saving}>
              <Trash2 size={15} /> {saving ? 'Menghapus…' : deleteTarget.type === 'category' ? 'Hapus pos' : 'Hapus item'}
            </Button>
          </div>
        </Modal>
      )}
    </>
  )
}
