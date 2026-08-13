import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, BellRing, CalendarDays, Check, Clock3, CreditCard, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useFinance } from '../lib/FinanceContext'
import { formatCurrency, formatDate, formatIDR, initials } from '../lib/format'
import { Badge, Button, Card, Modal, PageHeader } from '../components/ui'
import { MoneyInput } from '../components/MoneyInput'
import type { Bill, BudgetCategory } from '../types'

const today = new Date().toISOString().slice(0, 10)
const paymentMethodLabel = (method?: Bill['paymentMethod']) => method === 'vcc' ? 'VCC' : method === 'ewallet' ? 'E-Wallet' : method === 'cash' ? 'Tunai' : 'Transfer bank'
export function Bills() {
  const { bills, accounts, refresh, user } = useFinance(),
    [tab, setTab] = useState<'upcoming' | 'paid' | 'all'>('upcoming'),
    [createModal, setCreateModal] = useState(false),
    [editing, setEditing] = useState<Bill | null>(null),
    [billUnitPrice, setBillUnitPrice] = useState(0),
    [billQuantity, setBillQuantity] = useState(1),
    [billCurrency, setBillCurrency] = useState<'IDR' | 'USD'>('IDR'),
    [payment, setPayment] = useState<Bill | null>(null),
    [paymentSource, setPaymentSource] = useState<'bank' | 'vcc'>('bank'),
    [paymentAccountId, setPaymentAccountId] = useState(''),
    [deleteTarget, setDeleteTarget] = useState<Bill | null>(null),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(''),
    [budgetCategories, setBudgetCategories] = useState<BudgetCategory[]>([])
  const canManage = !!user && ['owner', 'admin', 'finance'].includes(user.role),
    paymentAccounts = accounts.filter((account) => ['bank', 'cash', 'ewallet'].includes(account.kind)),
    vccAccounts = accounts.filter((account) => account.kind === 'deposit'),
    open = bills.filter((bill) => bill.status !== 'paid'),
    attention = open.filter((bill) => bill.status === 'due' || bill.status === 'overdue'),
    filtered = useMemo(() => bills.filter((bill) => tab === 'all' || (tab === 'paid' ? bill.status === 'paid' : bill.status !== 'paid')), [bills, tab])
  const total = open.reduce((sum, bill) => sum + bill.amount, 0),
    due30 = open.filter((bill) => new Date(`${bill.dueDate}T12:00:00`).getTime() <= Date.now() + 30 * 86400000).reduce((sum, bill) => sum + bill.amount, 0)
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
  async function api(url: string, body: unknown, method = 'POST') {
    setSaving(true)
    setError('')
    try {
      const response = await fetch(url, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const result = (await response.json().catch(() => ({}))) as {
        error?: string
      }
      if (!response.ok) throw new Error(result.error || 'Tagihan belum dapat disimpan')
      await refresh()
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Terjadi kesalahan')
      return false
    } finally {
      setSaving(false)
    }
  }
  async function createBill(formData: FormData) {
    const reminderDays = String(formData.get('reminderDays')).split(',').map(Number)
    const ok = await api(
      editing ? `/api/bills/${editing.id}` : '/api/bills',
      {
        vendor: String(formData.get('vendor')).trim(),
        description: String(formData.get('description')).trim(),
        dueDate: String(formData.get('dueDate')),
        unitPrice: Number(formData.get('unitPrice')),
        quantity: Number(formData.get('quantity')),
        paymentMethod: String(formData.get('paymentMethod')),
        currency: String(formData.get('currency')),
        recurrence: String(formData.get('recurrence')),
        owner: String(formData.get('owner')).trim() || undefined,
        autoRenew: formData.get('autoRenew') === 'on',
        reminderDays,
      },
      editing ? 'PATCH' : 'POST',
    )
    if (ok) {
      setCreateModal(false)
      setEditing(null)
    }
  }
  async function removeBill(bill: Bill) {
    const ok = await api(`/api/bills/${bill.id}`, {}, 'DELETE')
    if (ok) setDeleteTarget(null)
  }
  async function payBill(formData: FormData) {
    if (!payment) return
    const ok = await api(`/api/bills/${payment.id}/pay`, {
      transactionDate: String(formData.get('transactionDate')),
      accountId: String(formData.get('accountId')),
      amount: Number(formData.get('amount')),
      reference: String(formData.get('reference')).trim() || undefined,
      budgetCategoryId: String(formData.get('budgetCategoryId')) || undefined,
      overrideReason: String(formData.get('overrideReason')).trim() || undefined,
    })
    if (ok) setPayment(null)
  }
  return (
    <>
      <PageHeader
        eyebrow="KEWAJIBAN"
        title="Tagihan & renewal"
        description="Jadwal renewal dihitung dari data jatuh tempo dan membuat periode berikutnya setelah dibayar."
        action={
          canManage ? (
            <Button
              onClick={() => {
                setError('')
                setEditing(null)
                setBillUnitPrice(0)
                setBillQuantity(1)
                setBillCurrency('IDR')
                setCreateModal(true)
              }}
            >
              <Plus size={16} /> Tambah tagihan
            </Button>
          ) : undefined
        }
      />
      {error && !createModal && !payment && !editing && (
        <div className="budget-alert error">
          <span>{error}</span>
          <button onClick={() => setError('')}>Tutup</button>
        </div>
      )}
      <div className="mini-stats four">
        <Card>
          <span>Tagihan mendatang</span>
          <strong>{formatCurrency(total, 'IDR')}</strong>
          <small className="warning-text">{open.length} tagihan</small>
        </Card>
        <Card>
          <span>Jatuh tempo 30 hari</span>
          <strong>{formatCurrency(due30, 'IDR')}</strong>
          <small>{open.filter((bill) => new Date(bill.dueDate).getTime() <= Date.now() + 30 * 86400000).length} tagihan</small>
        </Card>
        <Card>
          <span>Biaya berulang</span>
          <strong>
            {formatCurrency(
              open.filter((bill) => bill.recurrence !== 'Sekali').reduce((sum, bill) => sum + bill.amount, 0),
              'IDR',
            )}
          </strong>
          <small>{open.filter((bill) => bill.recurrence !== 'Sekali').length} layanan aktif</small>
        </Card>
        <Card>
          <span>Sudah dibayar</span>
          <strong className="positive">
            {formatCurrency(
              bills.filter((bill) => bill.status === 'paid').reduce((sum, bill) => sum + bill.amount, 0),
              'IDR',
            )}
          </strong>
          <small>{bills.filter((bill) => bill.status === 'paid').length} pembayaran</small>
        </Card>
      </div>
      {attention.length > 0 && (
        <Card className="notice-card">
          <BellRing size={20} />
          <div>
            <strong>{attention.length} layanan memerlukan perhatian</strong>
            <span>
              {attention.filter((bill) => bill.status === 'overdue').length} terlambat dan {attention.filter((bill) => bill.status === 'due').length} segera jatuh tempo.
            </span>
          </div>
          <button onClick={() => setTab('upcoming')}>Tinjau sekarang</button>
        </Card>
      )}
      <Card className="data-card bills-table">
        <div className="tab-bar">
          <button className={tab === 'upcoming' ? 'active' : ''} onClick={() => setTab('upcoming')}>
            Akan datang <em>{open.length}</em>
          </button>
          <button className={tab === 'paid' ? 'active' : ''} onClick={() => setTab('paid')}>
            Sudah dibayar
          </button>
          <button className={tab === 'all' ? 'active' : ''} onClick={() => setTab('all')}>
            Semua layanan
          </button>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Service & package</th>
                <th>Jatuh tempo</th>
                <th>Siklus</th>
                <th>PIC</th>
                <th>Renewal</th>
                <th>Status</th>
                <th className="align-right">Nominal</th>
                <th className="align-right">Tindakan</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((bill, index) => (
                <tr key={bill.id}>
                  <td>
                    <span className={`vendor-avatar vendor-${index % 4}`}>{initials(bill.vendor)}</span>
                    <span>
                      <strong>{bill.vendor}</strong>
                      <small>{bill.description} · {paymentMethodLabel(bill.paymentMethod)}</small>
                    </span>
                  </td>
                  <td>
                    <span className="date-cell">
                      <CalendarDays size={15} />
                      {formatDate(bill.dueDate)}
                    </span>
                  </td>
                  <td>{bill.recurrence}</td>
                  <td>
                    {bill.owner ? (
                      <span className="owner-chip">
                        {bill.owner[0]}
                        <em>{bill.owner}</em>
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    {bill.autoRenew ? (
                      <Badge tone="info">
                        <RefreshCw size={12} /> Otomatis
                      </Badge>
                    ) : (
                      <Badge>Manual</Badge>
                    )}
                  </td>
                  <td>
                    <Badge tone={bill.status === 'paid' ? 'success' : bill.status === 'overdue' ? 'danger' : bill.status === 'due' ? 'warning' : 'neutral'}>
                      {bill.status === 'paid' ? (
                        <>
                          <Check size={12} /> Dibayar
                        </>
                      ) : bill.status === 'overdue' ? (
                        <>
                          <Clock3 size={12} /> Terlambat
                        </>
                      ) : bill.status === 'due' ? (
                        <>
                          <Clock3 size={12} /> Segera
                        </>
                      ) : (
                        'Terjadwal'
                      )}
                    </Badge>
                  </td>
                  <td className="align-right amount">{formatCurrency(bill.amount, bill.currency)}</td>
                  <td className="align-right">
                    <div className="row-actions">
                      {canManage && bill.status !== 'paid' ? (
                        <>
                          <button
                            className="reject"
                            onClick={() => {
                              setEditing(bill)
                              setBillUnitPrice(bill.unitPrice || bill.amount)
                              setBillQuantity(bill.quantity || 1)
                              setBillCurrency(bill.currency)
                              setCreateModal(true)
                            }}
                          >
                            Edit
                          </button>
                          <button className="reject" onClick={() => setDeleteTarget(bill)}>
                            Hapus
                          </button>
                          <button
                            className="approve"
                            onClick={() => {
                              setError('')
                              setPaymentSource(bill.paymentMethod === 'vcc' ? 'vcc' : 'bank')
                              setPaymentAccountId('')
                              setPayment(bill)
                            }}
                          >
                            <CreditCard size={13} /> Bayar
                          </button>
                        </>
                      ) : canManage ? (
                        <button className="reject" onClick={() => setDeleteTarget(bill)}>Hapus</button>
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
        {!filtered.length && (
          <div className="dashboard-empty">
            <CalendarDays size={25} />
            <strong>Belum ada tagihan</strong>
            <span>Tambahkan layanan agar pengingat renewal muncul otomatis.</span>
          </div>
        )}
      </Card>
      {createModal && (
        <Modal
          title={editing ? 'Edit tagihan' : 'Tambah tagihan atau renewal'}
          description="Atur jadwal, siklus, dan pengingat internal."
          onClose={() => {
            setCreateModal(false)
            setEditing(null)
            setError('')
          }}
        >
          <form className="form-grid" action={createBill}>
            {error && <div className="auth-error span-2">{error}</div>}
            <label>
              Service
              <input name="vendor" required minLength={2} maxLength={120} defaultValue={editing?.vendor || ''} placeholder="Contoh: DigitalOcean" />
            </label>
            <label>
              Jatuh tempo
              <input name="dueDate" type="date" required defaultValue={editing?.dueDate || ''} />
            </label>
            <label className="span-2">
              Package
              <input name="description" required minLength={2} maxLength={200} defaultValue={editing?.description || ''} placeholder="Contoh: Basic Droplet 4 GB" />
            </label>
            <label>
              Harga satuan
              <MoneyInput name="unitPrice" min="1" required value={billUnitPrice || ''} onValueChange={setBillUnitPrice} />
            </label>
            <label>
              Jumlah
              <input name="quantity" type="number" min="0.01" step="0.01" value={billQuantity} onChange={(event) => setBillQuantity(Number(event.target.value))} required />
            </label>
            <label>
              Metode pembayaran
              <select name="paymentMethod" defaultValue={editing?.paymentMethod || 'transfer'}>
                <option value="transfer">Transfer</option>
                <option value="ewallet">E-Wallet</option>
                <option value="cash">Cash</option>
                <option value="vcc">VCC / saldo deposit</option>
              </select>
            </label>
            <label>
              Mata uang
              <select name="currency" value={billCurrency} onChange={(event) => setBillCurrency(event.target.value as 'IDR' | 'USD')}>
                <option value="IDR">IDR</option>
                <option value="USD">USD</option>
              </select>
            </label>
            <label>
              Siklus
              <select name="recurrence" defaultValue={editing?.recurrence === 'Bulanan' ? 'monthly' : editing?.recurrence === 'Tahunan' ? 'yearly' : 'once'}>
                <option value="monthly">Bulanan</option>
                <option value="yearly">Tahunan</option>
                <option value="once">Sekali</option>
              </select>
            </label>
            <label>
              PIC
              <input name="owner" maxLength={100} defaultValue={editing?.owner || ''} />
            </label>
            <label>
              Pengingat
              <select name="reminderDays" defaultValue={editing?.reminderDays?.join(',') || '14,7,1'}>
                <option value="14,7,1">14, 7, dan 1 hari</option>
                <option value="7,3,1">7, 3, dan 1 hari</option>
                <option value="30,14,7">30, 14, dan 7 hari</option>
              </select>
            </label>
            <label className="checkbox-label">
              <input name="autoRenew" type="checkbox" defaultChecked={editing?.autoRenew || false} /> Renewal otomatis oleh service
            </label>
            <div className="income-journal-note span-2">
              <CreditCard size={20} />
              <div>
                <strong>Total: {formatCurrency(billUnitPrice * billQuantity, billCurrency)}</strong>
                <span>Dihitung otomatis dari harga satuan × jumlah.</span>
              </div>
            </div>
            <div className="modal-actions span-2">
              <Button variant="secondary" onClick={() => setCreateModal(false)}>
                Batal
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Menyimpan…' : 'Simpan tagihan'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {payment && (
        <Modal
          title={`Bayar ${payment.vendor}`}
          description={`${payment.description} · ${formatIDR(payment.amount)}`}
          onClose={() => {
            setPayment(null)
            setError('')
          }}
        >
          <form className="form-grid" action={payBill}>
            {error && <div className="auth-error span-2">{error}</div>}
            <label>
              Tanggal pembayaran
              <input name="transactionDate" type="date" defaultValue={today} required />
            </label>
            <label>
              Nominal aktual
              <MoneyInput name="amount" min="1" defaultValue={payment.amount} required />
            </label>
            <label className="span-2">
              Sumber pembayaran
              <select value={paymentSource} onChange={(event) => { setPaymentSource(event.target.value as 'bank' | 'vcc'); setPaymentAccountId('') }}>
                <option value="bank">Rekening, kas, atau e-wallet</option>
                <option value="vcc">VCC / saldo deposit</option>
              </select>
            </label>
            <label className="span-2">
              {paymentSource === 'vcc' ? 'Pilih VCC' : 'Pilih rekening'}
              <select name="accountId" value={paymentAccountId} onChange={(event) => setPaymentAccountId(event.target.value)} required>
                <option value="" disabled>
                  {paymentSource === 'vcc' ? 'Pilih kartu VCC' : 'Pilih rekening perusahaan'}
                </option>
                {(paymentSource === 'vcc' ? vccAccounts : paymentAccounts).filter((account) => account.currency === payment.currency).map((account) => (
                  <option value={account.id} key={account.id}>
                    {account.name}{account.maskedNumber ? ` ${account.maskedNumber}` : ''} — {formatCurrency(account.balance, account.currency)}
                  </option>
                ))}
              </select>
            </label>
            <label className="span-2">
              Pos RAB <span className="optional-label">Opsional</span>
              <select name="budgetCategoryId">
                <option value="">Di luar RAB</option>
                {budgetCategories.map((category) => (
                  <option value={category.id} key={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {paymentSource === 'vcc' ? 'Referensi pembayaran' : 'Referensi bank'}
              <input name="reference" maxLength={100} />
            </label>
            <label>
              Alasan override RAB <span className="optional-label">Jika diperlukan</span>
              <input name="overrideReason" maxLength={500} />
            </label>
            <div className="form-note span-2">
              {paymentSource === 'vcc' ? 'Saldo VCC akan berkurang sesuai nominal pembayaran.' : 'Saldo rekening perusahaan akan berkurang sesuai nominal pembayaran.'} Tagihan berulang otomatis menghasilkan jadwal periode berikutnya.
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
      {deleteTarget && (
        <Modal
          title={deleteTarget.status === 'paid' ? 'Hapus dari daftar renewal?' : 'Hapus jadwal renewal?'}
          description="Konfirmasi diperlukan sebelum data diremove"
          onClose={() => !saving && setDeleteTarget(null)}
        >
          {error && <div className="auth-error delete-confirmation-error">{error}</div>}
          <div className="delete-confirmation">
            <span className="delete-confirmation-icon"><Trash2 size={25} /></span>
            <div>
              <strong>{deleteTarget.vendor}</strong>
              <p>{deleteTarget.description} · jatuh tempo {formatDate(deleteTarget.dueDate)}</p>
            </div>
          </div>
          <div className="delete-confirmation-note">
            <AlertTriangle size={17} />
            <span>
              {deleteTarget.status === 'paid'
                ? 'Data akan disembunyikan dari daftar renewal. Transaksi pembayaran tetap tersimpan dan saldo tidak berubah.'
                : 'Jadwal renewal ini akan dibatalkan dan tidak lagi muncul pada pengingat jatuh tempo.'}
            </span>
          </div>
          <div className="modal-actions delete-confirmation-actions">
            <Button variant="secondary" onClick={() => setDeleteTarget(null)} disabled={saving}>Batal</Button>
            <Button variant="danger" onClick={() => void removeBill(deleteTarget)} disabled={saving}>
              <Trash2 size={15} /> {saving ? 'Menghapus…' : 'Hapus renewal'}
            </Button>
          </div>
        </Modal>
      )}
    </>
  )
}
