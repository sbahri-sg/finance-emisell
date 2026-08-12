import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Plus, TrendingDown } from 'lucide-react'
import { useFinance } from '../lib/FinanceContext'
import { formatDate, formatIDR } from '../lib/format'
import { Badge, Button, Card, Modal, PageHeader } from '../components/ui'
import type { BudgetCategory, DepositAccount } from '../types'

const today = new Date().toISOString().slice(0, 10)
export function Deposits() {
  const navigate = useNavigate(),
    { deposits, accounts, transactions, refresh, user } = useFinance(),
    [action, setAction] = useState<{
      kind: 'topup' | 'usage'
      deposit: DepositAccount
    } | null>(null),
    [createDeposit, setCreateDeposit] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(''),
    [budgetCategories, setBudgetCategories] = useState<BudgetCategory[]>([])
  const total = deposits.reduce((sum, deposit) => sum + deposit.balance, 0),
    usage = deposits.reduce((sum, deposit) => sum + deposit.monthlyUsage, 0),
    daily = deposits.reduce((sum, deposit) => sum + deposit.dailyAverage, 0),
    canManage = !!user && ['owner', 'admin', 'finance'].includes(user.role),
    sources = accounts.filter((account) => ['bank', 'cash', 'ewallet'].includes(account.kind)),
    activities = transactions.filter((transaction) => ['deposit_topup', 'deposit_usage'].includes(transaction.kind)).slice(0, 8)
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
  function startTopup() {
    setError('')
    if (!deposits.length) {
      setCreateDeposit(true)
      return
    }
    setAction({ kind: 'topup', deposit: deposits[0] })
  }
  async function createDepositAccount(formData: FormData) {
    setSaving(true)
    setError('')
    try {
      const platform = String(formData.get('platform')).trim(),
        institution = String(formData.get('institution')).trim(),
        currency = String(formData.get('currency')) as 'IDR' | 'USD',
        lowBalanceThreshold = Number(formData.get('lowBalanceThreshold'))
      const response = await fetch('/api/accounts', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: platform,
            institution,
            kind: 'deposit',
            maskedNumber: String(formData.get('maskedNumber')).trim() || undefined,
            currency,
            openingBalance: 0,
            lowBalanceThreshold,
            color: '#4f78a5',
          }),
        }),
        result = (await response.json().catch(() => ({}))) as {
          id?: string
          error?: string
        }
      if (!response.ok || !result.id) throw new Error(result.error || 'Akun deposit belum dapat dibuat')
      await refresh()
      setCreateDeposit(false)
      setAction({
        kind: 'topup',
        deposit: {
          id: result.id,
          platform,
          accountName: institution,
          balance: 0,
          monthlyUsage: 0,
          dailyAverage: 0,
          lowBalanceThreshold,
          color: '#4f78a5',
        },
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Terjadi kesalahan')
    } finally {
      setSaving(false)
    }
  }
  async function submit(formData: FormData) {
    if (!action) return
    setSaving(true)
    setError('')
    try {
      const payload =
        action.kind === 'topup'
          ? {
              transactionDate: String(formData.get('transactionDate')),
              sourceAccountId: String(formData.get('sourceAccountId')),
              amount: Number(formData.get('amount')),
              proofUrl: String(formData.get('proofUrl')).trim() || undefined,
            }
          : {
              transactionDate: String(formData.get('transactionDate')),
              amount: Number(formData.get('amount')),
              description: String(formData.get('description')).trim(),
              reference: String(formData.get('reference')).trim() || undefined,
              budgetCategoryId: String(formData.get('budgetCategoryId')) || undefined,
              overrideReason: String(formData.get('overrideReason')).trim() || undefined,
            }
      const response = await fetch(`/api/deposits/${action.deposit.id}/${action.kind}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const result = (await response.json().catch(() => ({}))) as {
        error?: string
      }
      if (!response.ok) throw new Error(result.error || 'Aktivitas deposit belum dapat disimpan')
      await refresh()
      setAction(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Terjadi kesalahan')
    } finally {
      setSaving(false)
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="DANA TERSIMPAN"
        title="Deposit platform"
        description="Top-up adalah perpindahan aset; pemakaian menjadi pengeluaran saat dicatat."
        action={
          canManage ? (
            <Button onClick={startTopup}>
              <Plus size={16} /> Catat top-up
            </Button>
          ) : undefined
        }
      />
      {error && !action && (
        <div className="budget-alert error">
          <span>{error}</span>
          <button onClick={() => setError('')}>Tutup</button>
        </div>
      )}
      <div className="deposit-hero">
        <div>
          <span>Total saldo deposit</span>
          <strong>{formatIDR(total)}</strong>
          <small>Dicatat sebagai aset, bukan pengeluaran</small>
        </div>
        <div>
          <span>Pemakaian bulan ini</span>
          <strong>{formatIDR(usage)}</strong>
          <small>
            <TrendingDown size={13} /> Berdasarkan jurnal aktual
          </small>
        </div>
        <div>
          <span>Estimasi kebutuhan 30 hari</span>
          <strong>{formatIDR(daily * 30)}</strong>
          <small>Rata-rata pemakaian 30 hari</small>
        </div>
      </div>
      <div className="deposit-cards">
        {deposits.map((deposit) => {
          const days = deposit.dailyAverage > 0 ? Math.floor(deposit.balance / deposit.dailyAverage) : null,
            low = deposit.balance < deposit.lowBalanceThreshold
          return (
            <Card className="deposit-card" key={deposit.id}>
              <div className="deposit-card-head">
                <span className="platform-logo" style={{ background: deposit.color }}>
                  {deposit.platform[0]}
                </span>
                <div>
                  <strong>{deposit.platform}</strong>
                  <span>{deposit.accountName || 'Akun platform'}</span>
                </div>
                {low ? (
                  <Badge tone="danger">
                    <AlertTriangle size={12} /> Saldo rendah
                  </Badge>
                ) : (
                  <Badge tone="success">Aktif</Badge>
                )}
              </div>
              <div className="deposit-main">
                <span>Saldo saat ini</span>
                <strong>{formatIDR(deposit.balance)}</strong>
                <small>
                  {days === null ? (
                    'Belum ada pola pemakaian'
                  ) : (
                    <>
                      Diperkirakan cukup untuk <b>{days} hari</b>
                    </>
                  )}
                </small>
              </div>
              <div className="usage-bar">
                <span
                  style={{
                    width: `${days === null ? 100 : Math.min(100, (days / 30) * 100)}%`,
                    background: low ? '#bc5149' : deposit.color,
                  }}
                />
              </div>
              <div className="deposit-meta">
                <div>
                  <span>Pemakaian bulan ini</span>
                  <strong>{formatIDR(deposit.monthlyUsage)}</strong>
                </div>
                <div>
                  <span>Batas minimum</span>
                  <strong>{formatIDR(deposit.lowBalanceThreshold)}</strong>
                </div>
              </div>
              {canManage && (
                <div className="page-actions">
                  <Button variant="secondary" onClick={() => navigate('/rekening')}>
                    Kelola akun
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setError('')
                      setAction({ kind: 'usage', deposit })
                    }}
                  >
                    <ArrowUpRight size={15} /> Catat pemakaian
                  </Button>
                  <Button
                    onClick={() => {
                      setError('')
                      setAction({ kind: 'topup', deposit })
                    }}
                  >
                    <Plus size={15} /> Top-up
                  </Button>
                </div>
              )}
            </Card>
          )
        })}
      </div>
      {!deposits.length && (
        <Card className="data-card">
          <div className="dashboard-empty deposit-onboarding">
            <AlertTriangle size={25} />
            <strong>Belum ada akun deposit</strong>
            <span>Buat akun platform terlebih dahulu, lalu catat top-up dari rekening perusahaan.</span>
            {canManage && (
              <Button
                onClick={() => {
                  setError('')
                  setCreateDeposit(true)
                }}
              >
                <Plus size={15} /> Siapkan akun deposit
              </Button>
            )}
          </div>
        </Card>
      )}
      <Card className="data-card">
        <div className="card-heading">
          <div>
            <h2>Aktivitas deposit terbaru</h2>
            <p>Perpindahan dan pemakaian berdasarkan jurnal</p>
          </div>
        </div>
        <div className="activity-list">
          {activities.map((transaction) => (
            <div key={transaction.id}>
              <span className={`activity-icon ${transaction.kind === 'deposit_topup' ? 'topup' : 'usage'}`}>{transaction.kind === 'deposit_topup' ? <ArrowDownLeft size={17} /> : <ArrowUpRight size={17} />}</span>
              <div>
                <strong>{transaction.description}</strong>
                <span>
                  {formatDate(transaction.date)} · {transaction.account}
                </span>
              </div>
              <strong className={transaction.amount > 0 ? 'positive' : ''}>
                {transaction.amount > 0 ? '+' : ''}
                {formatIDR(transaction.amount)}
              </strong>
            </div>
          ))}
          {!activities.length && (
            <div className="dashboard-empty">
              <TrendingDown size={24} />
              <strong>Belum ada aktivitas deposit</strong>
              <span>Top-up dan pemakaian akan tampil di sini.</span>
            </div>
          )}
        </div>
      </Card>
      {createDeposit && (
        <Modal
          title="Siapkan akun deposit"
          description="Tambahkan platform prabayar sebelum mencatat top-up pertama."
          onClose={() => {
            setCreateDeposit(false)
            setError('')
          }}
        >
          <form className="form-grid" action={createDepositAccount}>
            {error && <div className="auth-error span-2">{error}</div>}
            <label>
              Nama platform
              <input name="platform" required minLength={2} maxLength={100} placeholder="Meta Ads" />
            </label>
            <label>
              Nama akun bisnis
              <input name="institution" required minLength={2} maxLength={100} placeholder="Emisell Ads" />
            </label>
            <label>
              ID akun <span className="optional-label">Opsional</span>
              <input name="maskedNumber" maxLength={20} placeholder="•••• 1234" />
            </label>
            <label>
              Mata uang
              <select name="currency" defaultValue="IDR">
                <option value="IDR">IDR — Rupiah</option>
                <option value="USD">USD — Dollar</option>
              </select>
            </label>
            <label className="span-2">
              Peringatan saldo minimum
              <input name="lowBalanceThreshold" type="number" min="0" step="1000" defaultValue="1000000" required />
              <small>Dashboard memberi peringatan ketika saldo platform berada di bawah nominal ini.</small>
            </label>
            <div className="form-note span-2">Saldo awal dibuat Rp 0. Setelah akun tersimpan, formulir top-up langsung terbuka.</div>
            <div className="modal-actions span-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setCreateDeposit(false)
                  setError('')
                }}
              >
                Batal
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Membuat…' : 'Buat & lanjut top-up'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {action && (
        <Modal
          title={`${action.kind === 'topup' ? 'Top-up' : 'Catat pemakaian'} ${action.deposit.platform}`}
          description={action.kind === 'topup' ? 'Memindahkan dana dari rekening perusahaan ke aset deposit.' : 'Mengurangi deposit dan mencatat pengeluaran aktual.'}
          onClose={() => {
            setAction(null)
            setError('')
          }}
        >
          <form className="form-grid" action={submit}>
            {error && <div className="auth-error span-2">{error}</div>}
            <label>
              Tanggal
              <input name="transactionDate" type="date" defaultValue={today} required />
            </label>
            <label>
              Nominal
              <input name="amount" type="number" min="1" step="1" required />
            </label>
            {action.kind === 'topup' ? (
              <>
                {sources.length ? (
                  <label className="span-2">
                    Rekening sumber
                    <select name="sourceAccountId" defaultValue="" required>
                      <option value="" disabled>
                        Pilih rekening
                      </option>
                      {sources.map((account) => (
                        <option value={account.id} key={account.id}>
                          {account.name} — saldo {formatIDR(account.balance)}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <div className="deposit-source-empty span-2">
                    <AlertTriangle size={19} />
                    <span>
                      <strong>Belum ada rekening sumber</strong>
                      <small>Tambahkan rekening bank, kas, atau e-wallet sebelum melakukan top-up.</small>
                    </span>
                    <Button variant="secondary" onClick={() => navigate('/rekening')}>
                      Buka Rekening
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <>
                <label className="span-2">
                  Deskripsi
                  <input name="description" required minLength={3} maxLength={240} placeholder="Pemakaian iklan periode berjalan" />
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
                <label className="span-2">
                  Alasan override RAB <span className="optional-label">Jika diperlukan</span>
                  <input name="overrideReason" maxLength={500} />
                </label>
              </>
            )}
            {action.kind === 'topup' ? (
              <label className="span-2">
                Link bukti transaksi <span className="optional-label">Opsional</span>
                <input name="proofUrl" type="url" maxLength={500} placeholder="https://..." />
              </label>
            ) : (
              <label className="span-2">
                Referensi <span className="optional-label">Opsional</span>
                <input name="reference" maxLength={100} />
              </label>
            )}
            <div className="form-note span-2">{action.kind === 'topup' ? 'Top-up memindahkan saldo rekening ke deposit, sehingga total aset perusahaan tetap sama.' : 'Pemakaian mengurangi saldo deposit dan dicatat sebagai pengeluaran perusahaan.'}</div>
            <div className="modal-actions span-2">
              <Button variant="secondary" onClick={() => setAction(null)}>
                Batal
              </Button>
              <Button type="submit" disabled={saving || (action.kind === 'topup' && !sources.length)}>
                {saving ? 'Menyimpan…' : action.kind === 'topup' ? 'Simpan top-up' : 'Simpan pemakaian'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  )
}
