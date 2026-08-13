import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Check, CheckCircle2, Clock3, CreditCard, PackageCheck, Plus, Search, ShoppingBag, ShoppingCart, XCircle } from 'lucide-react'
import { Badge, Button, Card, ConfirmActionModal, Modal, PageHeader } from '../components/ui'
import { useFinance } from '../lib/FinanceContext'
import { formatDate, formatIDR } from '../lib/format'
import type { BudgetCategory, PurchaseRequest, PurchaseRequestStatus } from '../types'

const today = new Date().toISOString().slice(0, 10)
const statusLabel: Record<PurchaseRequestStatus, string> = {
  draft: 'Draft',
  submitted: 'Menunggu approval',
  approved: 'Disetujui',
  purchased: 'Sudah dibayar',
  received: 'Diterima',
  rejected: 'Ditolak',
}
function statusTone(status: PurchaseRequestStatus): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  if (status === 'received') return 'success'
  if (status === 'submitted') return 'warning'
  if (status === 'approved' || status === 'purchased') return 'info'
  if (status === 'rejected') return 'danger'
  return 'neutral'
}

export function PurchaseRequests() {
  const { purchaseRequests: requests, accounts, refresh, user } = useFinance()
  const [searchParams, setSearchParams] = useSearchParams()
  const [query, setQuery] = useState(''),
    [filter, setFilter] = useState<'all' | PurchaseRequestStatus>('all')
  const [createModal, setCreateModal] = useState(false),
    [approval, setApproval] = useState<PurchaseRequest | null>(null),
    [payment, setPayment] = useState<PurchaseRequest | null>(null),
    [rejectionTarget, setRejectionTarget] = useState<PurchaseRequest | null>(null)
  const [budgetCategories, setBudgetCategories] = useState<BudgetCategory[]>([]),
    [saving, setSaving] = useState(false),
    [error, setError] = useState('')
  const canFinance = !!user && ['owner', 'admin', 'finance'].includes(user.role),
    canAdmin = !!user && ['owner', 'admin'].includes(user.role)
  const paymentAccounts = accounts.filter((account) => ['bank', 'cash', 'ewallet'].includes(account.kind))
  useEffect(() => {
    const month = new Date().toISOString().slice(0, 7)
    void fetch(`/api/budgets?month=${month}`, { credentials: 'include' })
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
  useEffect(() => {
    if (searchParams.get('buat') === '1') {
      setError('')
      setCreateModal(true)
      const next = new URLSearchParams(searchParams)
      next.delete('buat')
      setSearchParams(next, { replace: true })
    }
  }, [searchParams, setSearchParams])
  const filtered = useMemo(() => requests.filter((request) => `${request.requestNumber} ${request.title} ${request.requestedBy} ${request.department}`.toLowerCase().includes(query.toLowerCase()) && (filter === 'all' || request.status === filter)), [filter, query, requests])
  const total = (status: PurchaseRequestStatus) => requests.filter((request) => request.status === status).reduce((sum, request) => sum + request.amount, 0)

  async function api(url: string, body: unknown) {
    setSaving(true)
    setError('')
    try {
      const response = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const result = (await response.json().catch(() => ({}))) as {
        error?: string
      }
      if (!response.ok) throw new Error(result.error || 'Tindakan belum dapat disimpan')
      await refresh()
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Terjadi kesalahan')
      return false
    } finally {
      setSaving(false)
    }
  }
  async function createRequest(formData: FormData) {
    const ok = await api('/api/purchase-requests', {
      department: String(formData.get('department')),
      title: String(formData.get('title')).trim(),
      purpose: String(formData.get('purpose')).trim(),
      urgency: String(formData.get('urgency')) === 'Mendesak' ? 'urgent' : 'normal',
      vendor: String(formData.get('vendor')).trim() || undefined,
      quantity: Number(formData.get('quantity')),
      unitPrice: Number(formData.get('unitPrice')),
      budgetCategoryId: String(formData.get('budgetCategoryId')) || undefined,
    })
    if (ok) setCreateModal(false)
  }
  async function approveRequest(formData: FormData) {
    if (!approval) return
    const ok = await api(`/api/purchase-requests/${approval.id}/transition`, {
      status: 'approved',
      note: String(formData.get('note')).trim() || undefined,
      overrideReason: String(formData.get('overrideReason')).trim() || undefined,
    })
    if (ok) setApproval(null)
  }
  async function rejectRequest() {
    if (!rejectionTarget) return
    const ok = await api(`/api/purchase-requests/${rejectionTarget.id}/transition`, {
      status: 'rejected',
      note: 'Ditolak melalui daftar pengajuan',
    })
    if (ok) setRejectionTarget(null)
  }
  async function payRequest(formData: FormData) {
    if (!payment) return
    const ok = await api(`/api/purchase-requests/${payment.id}/pay`, {
      transactionDate: String(formData.get('transactionDate')),
      accountId: String(formData.get('accountId')),
      amount: Number(formData.get('amount')),
      paymentMethod: String(formData.get('paymentMethod')),
      proofReference: String(formData.get('proofReference')).trim() || undefined,
      overrideReason: String(formData.get('overrideReason')).trim() || undefined,
    })
    if (ok) setPayment(null)
  }
  async function receiveRequest(request: PurchaseRequest) {
    await api(`/api/purchase-requests/${request.id}/transition`, {
      status: 'received',
      note: 'Barang/jasa telah diterima dan diperiksa',
    })
  }

  return (
    <>
      <PageHeader
        eyebrow="PROCUREMENT"
        title="Pengajuan belanja"
        description="Ajukan kebutuhan, setujui RAB, catat pembayaran, lalu konfirmasi penerimaan."
        action={
          <Button
            onClick={() => {
              setError('')
              setCreateModal(true)
            }}
          >
            <Plus size={16} /> Buat pengajuan
          </Button>
        }
      />
      {error && !createModal && !approval && !payment && (
        <div className="budget-alert error">
          <span>{error}</span>
          <button onClick={() => setError('')}>Tutup</button>
        </div>
      )}
      <div className="purchase-flow">
        <div>
          <span>
            <ShoppingCart size={16} />
          </span>
          <strong>1. Diajukan</strong>
          <small>Staff mengisi kebutuhan</small>
        </div>
        <i />
        <div>
          <span>
            <Check size={16} />
          </span>
          <strong>2. Disetujui</strong>
          <small>RAB dicadangkan</small>
        </div>
        <i />
        <div>
          <span>
            <CreditCard size={16} />
          </span>
          <strong>3. Dibayar</strong>
          <small>Saldo rekening berkurang</small>
        </div>
        <i />
        <div>
          <span>
            <PackageCheck size={16} />
          </span>
          <strong>4. Diterima</strong>
          <small>Barang dan bukti dikonfirmasi</small>
        </div>
      </div>
      <div className="mini-stats four">
        <Card>
          <span>Menunggu approval</span>
          <strong>{formatIDR(total('submitted'))}</strong>
          <small className="warning-text">{requests.filter((r) => r.status === 'submitted').length} pengajuan</small>
        </Card>
        <Card>
          <span>Sudah disetujui</span>
          <strong>{formatIDR(total('approved'))}</strong>
          <small>Anggaran dicadangkan</small>
        </Card>
        <Card>
          <span>Sudah dibayar</span>
          <strong>{formatIDR(total('purchased'))}</strong>
          <small>{requests.filter((r) => r.status === 'purchased').length} menunggu penerimaan</small>
        </Card>
        <Card>
          <span>Selesai</span>
          <strong className="positive">{formatIDR(total('received'))}</strong>
          <small>{requests.filter((r) => r.status === 'received').length} pengajuan</small>
        </Card>
      </div>
      <Card className="data-card">
        <div className="table-toolbar">
          <label className="table-search">
            <Search size={17} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari nomor, kebutuhan, atau pemohon" />
          </label>
          <div className="filter-group">
            <select value={filter} onChange={(event) => setFilter(event.target.value as 'all' | PurchaseRequestStatus)}>
              <option value="all">Semua status</option>
              <option value="submitted">Menunggu approval</option>
              <option value="approved">Disetujui</option>
              <option value="purchased">Sudah dibayar</option>
              <option value="received">Diterima</option>
              <option value="rejected">Ditolak</option>
            </select>
          </div>
        </div>
        <div className="table-scroll">
          <table className="purchase-table">
            <thead>
              <tr>
                <th>Pengajuan</th>
                <th>Pemohon</th>
                <th>Tanggal</th>
                <th>Urgensi</th>
                <th>Status</th>
                <th className="align-right">Estimasi/aktual</th>
                <th className="align-right">Tindakan</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((request) => (
                <tr key={request.id}>
                  <td>
                    <span className="purchase-icon">
                      <ShoppingBag size={15} />
                    </span>
                    <span>
                      <strong>{request.title}</strong>
                      <small>
                        {request.requestNumber} · {request.itemCount} item · {request.department}
                        {request.budgetCategory ? ` · RAB: ${request.budgetCategory}` : ''}
                      </small>
                    </span>
                  </td>
                  <td>
                    <span className="requester">
                      <em>{request.requestedBy[0]}</em>
                      <span>{request.requestedBy}</span>
                    </span>
                  </td>
                  <td>{formatDate(request.requestedAt)}</td>
                  <td>
                    {request.urgency === 'Mendesak' ? (
                      <Badge tone="danger">
                        <Clock3 size={12} /> Mendesak
                      </Badge>
                    ) : (
                      <Badge>Normal</Badge>
                    )}
                  </td>
                  <td>
                    <Badge tone={statusTone(request.status)}>{statusLabel[request.status]}</Badge>
                  </td>
                  <td className="align-right amount">
                    {formatIDR(request.paidAmount ?? request.amount)}
                    {request.paidAmount && request.paidAmount !== request.amount ? <small>Estimasi {formatIDR(request.amount)}</small> : null}
                  </td>
                  <td className="align-right">
                    <div className="row-actions">
                      {request.status === 'submitted' && canFinance && (
                        <>
                          <button
                            className="approve"
                            onClick={() => {
                              setError('')
                              setApproval(request)
                            }}
                          >
                            <Check size={13} /> Setujui
                          </button>
                          <button className="reject" onClick={() => { setError(''); setRejectionTarget(request) }} aria-label={`Tolak ${request.title}`}>
                            <XCircle size={14} />
                          </button>
                        </>
                      )}
                      {request.status === 'approved' && canFinance && (
                        <button
                          className="approve"
                          onClick={() => {
                            setError('')
                            setPayment(request)
                          }}
                        >
                          <CreditCard size={13} /> Bayar
                        </button>
                      )}
                      {request.status === 'purchased' && (request.requestedById === user?.userId || canAdmin) && (
                        <button className="approve" onClick={() => void receiveRequest(request)}>
                          <PackageCheck size={13} /> Konfirmasi diterima
                        </button>
                      )}
                      {request.status === 'received' && (
                        <span className="done-label">
                          <CheckCircle2 size={14} /> Selesai
                        </span>
                      )}
                      {request.status === 'rejected' && <span>—</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="table-footer">
          Menampilkan {filtered.length} dari {requests.length} pengajuan <span>Saldo berubah hanya melalui pembayaran</span>
        </div>
      </Card>

      {createModal && (
        <Modal
          title="Buat pengajuan belanja"
          description="Pengajuan akan dikirim untuk pemeriksaan RAB."
          onClose={() => {
            setCreateModal(false)
            setError('')
          }}
        >
          <form className="form-grid" action={createRequest}>
            {error && <div className="auth-error span-2">{error}</div>}
            <label className="span-2">
              Nama kebutuhan
              <input name="title" required maxLength={120} />
            </label>
            <label>
              Divisi
              <select name="department">
                <option>Operasional</option>
                <option>Marketing</option>
                <option>IT</option>
                <option>Finance</option>
                <option>Umum</option>
              </select>
            </label>
            <label>
              Urgensi
              <select name="urgency">
                <option>Normal</option>
                <option>Mendesak</option>
              </select>
            </label>
            <label>
              Jumlah
              <input name="quantity" type="number" min="1" max="999" defaultValue="1" required />
            </label>
            <label>
              Estimasi harga per item
              <input name="unitPrice" type="number" min="1" step="1" required />
            </label>
            <label className="span-2">
              Pos RAB <span className="optional-label">Opsional</span>
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
              PIC <span className="optional-label">Opsional</span>
              <input name="vendor" maxLength={120} />
            </label>
            <label className="span-2">
              Alasan pembelian
              <textarea name="purpose" required minLength={5} maxLength={500} />
            </label>
            <div className="form-note span-2">Pengajuan belum mengurangi saldo. RAB dicadangkan setelah disetujui.</div>
            <div className="modal-actions span-2">
              <Button variant="secondary" onClick={() => setCreateModal(false)}>
                Batal
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Mengirim…' : 'Kirim pengajuan'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {approval && (
        <Modal
          title={`Setujui ${approval.requestNumber}`}
          description={`${approval.title} · ${formatIDR(approval.amount)}`}
          onClose={() => {
            setApproval(null)
            setError('')
          }}
        >
          <form className="form-grid" action={approveRequest}>
            {error && <div className="auth-error span-2">{error}</div>}
            <label className="span-2">
              Catatan persetujuan <span className="optional-label">Opsional</span>
              <textarea name="note" maxLength={500} placeholder="Catatan untuk Finance atau pemohon" />
            </label>
            <label className="span-2">
              Alasan melebihi RAB <span className="optional-label">Isi hanya jika anggaran tidak cukup</span>
              <textarea name="overrideReason" minLength={5} maxLength={500} placeholder="Owner/Admin wajib memberi alasan jika melampaui anggaran" />
            </label>
            <div className="form-note span-2">Persetujuan akan mencadangkan nominal estimasi pada pos RAB.</div>
            <div className="modal-actions span-2">
              <Button variant="secondary" onClick={() => setApproval(null)}>
                Batal
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Memeriksa…' : 'Setujui pengajuan'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {payment && (
        <Modal
          title={`Bayar ${payment.requestNumber}`}
          description="Pembayaran langsung membuat jurnal pengeluaran dan mengurangi saldo rekening."
          onClose={() => {
            setPayment(null)
            setError('')
          }}
        >
          <form className="form-grid" action={payRequest}>
            {error && <div className="auth-error span-2">{error}</div>}
            <label>
              Tanggal pembayaran
              <input name="transactionDate" type="date" defaultValue={today} required />
            </label>
            <label>
              Nominal aktual
              <input name="amount" type="number" min="1" step="1" defaultValue={payment.amount} required />
            </label>
            <label className="span-2">
              Rekening pembayaran
              <select name="accountId" defaultValue="" required>
                <option value="" disabled>
                  Pilih rekening
                </option>
                {paymentAccounts.map((account) => (
                  <option value={account.id} key={account.id}>
                    {account.name} — {formatIDR(account.balance)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Metode pembayaran
              <select name="paymentMethod" defaultValue="transfer">
                <option value="transfer">Transfer</option>
                <option value="ewallet">E-Wallet</option>
                <option value="cash">Cash</option>
              </select>
            </label>
            <label>
              Link bukti pembayaran <span className="optional-label">Opsional</span>
              <input name="proofReference" type="url" maxLength={240} placeholder="https://..." />
            </label>
            <label className="span-2">
              Alasan melebihi RAB <span className="optional-label">Jika nominal aktual melampaui sisa</span>
              <textarea name="overrideReason" minLength={5} maxLength={500} />
            </label>
            <div className="income-journal-note span-2">
              <CreditCard size={20} />
              <div>
                <strong>Jurnal otomatis dan atomik</strong>
                <span>Jika salah satu langkah gagal, status pengajuan dan saldo rekening tidak akan berubah.</span>
              </div>
            </div>
            <div className="modal-actions span-2">
              <Button variant="secondary" onClick={() => setPayment(null)}>
                Batal
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Memproses…' : 'Catat pembayaran'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
      <ConfirmActionModal
        open={Boolean(rejectionTarget)}
        title="Tolak pengajuan belanja?"
        subject={rejectionTarget ? `${rejectionTarget.requestNumber} · ${rejectionTarget.title}` : ''}
        detail={rejectionTarget ? `${rejectionTarget.requestedBy} · ${formatIDR(rejectionTarget.amount)}` : ''}
        note="Pengajuan akan berstatus Ditolak dan tidak dapat dilanjutkan ke pembayaran. Saldo rekening tidak berubah."
        confirmLabel="Tolak pengajuan"
        busy={saving}
        error={rejectionTarget ? error : ''}
        onClose={() => { setRejectionTarget(null); setError('') }}
        onConfirm={() => void rejectRequest()}
      />
    </>
  )
}
