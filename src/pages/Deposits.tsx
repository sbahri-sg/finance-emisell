import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, ArrowDownLeft, ArrowRight, ArrowUpRight, CheckCircle2, ClipboardCheck, FileSpreadsheet, FileUp, Pencil, Plus, ReceiptText, ShieldCheck, Trash2, TrendingDown, WalletCards } from 'lucide-react'
import { useFinance } from '../lib/FinanceContext'
import { formatDate, formatIDR } from '../lib/format'
import { Badge, Button, Card, ConfirmActionModal, Modal, PageHeader } from '../components/ui'
import type { Account, BudgetCategory, DepositAccount } from '../types'
import { readSelowWorkbook, type SelowImportRow } from '../lib/selowImport'

const today = new Date().toISOString().slice(0, 10)
const lastFour = (value: string) => value.replace(/\D/g, '').slice(-4)
const maskedVcc = (value: string) => `•••• ${lastFour(value)}`
type ImportBudgetCategory = BudgetCategory & { month: string }
type SelowImportResult = { imported: number; matched: number; duplicates: number; topups: number; debits: number }
export function Deposits() {
  const navigate = useNavigate(),
    { deposits, accounts, transactions, refresh, user } = useFinance(),
    [action, setAction] = useState<{
      kind: 'topup' | 'usage'
      deposit: DepositAccount
    } | null>(null),
    [createDeposit, setCreateDeposit] = useState(false),
    [newVccNumber, setNewVccNumber] = useState(''),
    [editingDeposit, setEditingDeposit] = useState<Account | null>(null),
    [reconcileDeposit, setReconcileDeposit] = useState<DepositAccount | null>(null),
    [statementBalance, setStatementBalance] = useState(0),
    [deleteTarget, setDeleteTarget] = useState<Account | null>(null),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(''),
    [budgetCategories, setBudgetCategories] = useState<BudgetCategory[]>([]),
    [importDeposit, setImportDeposit] = useState<DepositAccount | null>(null),
    [importRows, setImportRows] = useState<SelowImportRow[]>([]),
    [importBudgets, setImportBudgets] = useState<ImportBudgetCategory[]>([]),
    [importMappings, setImportMappings] = useState<Record<string, string>>({}),
    [importFileName, setImportFileName] = useState(''),
    [importResult, setImportResult] = useState<SelowImportResult | null>(null),
    [parsingImport, setParsingImport] = useState(false)
  const total = deposits.reduce((sum, deposit) => sum + deposit.balance, 0),
    usage = deposits.reduce((sum, deposit) => sum + deposit.monthlyUsage, 0),
    daily = deposits.reduce((sum, deposit) => sum + deposit.dailyAverage, 0),
    canManage = !!user && ['owner', 'admin', 'finance'].includes(user.role),
    sources = accounts.filter((account) => ['bank', 'cash', 'ewallet'].includes(account.kind)),
    activities = transactions.filter((transaction) => ['deposit_topup', 'deposit_usage'].includes(transaction.kind)).slice(0, 8)
  const importGroups = Array.from(new Set(importRows.filter((row) => row.amount < 0).map((row) => `${row.transactionDate.slice(0, 7)}|${row.merchant}`))),
    importTopupTotal = importRows.filter((row) => row.amount > 0).reduce((sum, row) => sum + row.amount, 0),
    importDebitTotal = importRows.filter((row) => row.amount < 0).reduce((sum, row) => sum + Math.abs(row.amount), 0),
    importReady = importRows.length > 0 && importGroups.every((group) => importMappings[group])
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
  async function createDepositAccount(formData: FormData) {
    setSaving(true)
    setError('')
    try {
      const platform = String(formData.get('platform')).trim(),
        institution = String(formData.get('institution')).trim(),
        currency = String(formData.get('currency')) as 'IDR' | 'USD',
        lowBalanceThreshold = Number(formData.get('lowBalanceThreshold'))
      if (lastFour(newVccNumber).length !== 4) throw new Error('Nomor VCC minimal harus memiliki 4 digit')
      const response = await fetch('/api/accounts', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: platform,
            institution,
            kind: 'deposit',
            maskedNumber: maskedVcc(newVccNumber),
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
      setNewVccNumber('')
      setAction({
        kind: 'topup',
        deposit: {
          id: result.id,
          platform,
          accountName: institution,
          maskedNumber: maskedVcc(newVccNumber),
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
  async function updateDeposit(formData: FormData) {
    if (!editingDeposit) return
    setSaving(true)
    setError('')
    try {
      const editLastFour = lastFour(String(formData.get('maskedNumber')))
      if (editLastFour.length !== 4) throw new Error('Empat digit terakhir VCC wajib diisi')
      const response = await fetch(`/api/accounts/${editingDeposit.id}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: String(formData.get('name')).trim(), institution: String(formData.get('institution')).trim() || undefined, kind: 'deposit', maskedNumber: maskedVcc(editLastFour), currency: editingDeposit.currency, lowBalanceThreshold: Number(formData.get('lowBalanceThreshold')) || undefined, color: String(formData.get('color')) }) })
      const result = (await response.json().catch(() => ({}))) as { error?: string }
      if (!response.ok) throw new Error(result.error || 'Deposit belum dapat diperbarui')
      await refresh()
      setEditingDeposit(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Terjadi kesalahan')
    } finally {
      setSaving(false)
    }
  }
  async function removeDeposit() {
    if (!deleteTarget) return
    setSaving(true)
    setError('')
    try {
      const response = await fetch(`/api/accounts/${deleteTarget.id}`, { method: 'DELETE', credentials: 'include' })
      const result = (await response.json().catch(() => ({}))) as { error?: string }
      if (!response.ok) throw new Error(result.error || 'Deposit belum dapat dihapus')
      await refresh()
      setDeleteTarget(null)
      setEditingDeposit(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Terjadi kesalahan')
    } finally {
      setSaving(false)
    }
  }
  async function reconcileDepositBalance(formData: FormData) {
    if (!reconcileDeposit) return
    setSaving(true)
    setError('')
    try {
      const response = await fetch(`/api/accounts/${reconcileDeposit.id}/reconcile`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ statementDate: String(formData.get('statementDate')), statementBalance, note: String(formData.get('note')).trim() || undefined }),
      })
      const result = (await response.json().catch(() => ({}))) as { error?: string }
      if (!response.ok) throw new Error(result.error || 'Saldo deposit belum dapat dicocokkan')
      await refresh()
      setReconcileDeposit(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Terjadi kesalahan')
    } finally {
      setSaving(false)
    }
  }
  function closeSelowImport() {
    setImportDeposit(null)
    setImportRows([])
    setImportBudgets([])
    setImportMappings({})
    setImportFileName('')
    setImportResult(null)
    setError('')
  }
  async function loadSelowFile(file?: File) {
    if (!file) return
    setParsingImport(true)
    setError('')
    setImportResult(null)
    try {
      const rows = await readSelowWorkbook(file),
        months = Array.from(new Set(rows.filter((row) => row.amount < 0).map((row) => row.transactionDate.slice(0, 7)))),
        budgetResponses = await Promise.all(
          months.map(async (month) => {
            const response = await fetch(`/api/budgets?month=${month}`, { credentials: 'include' }),
              raw = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(raw.error || `RAB ${month} belum dapat dimuat`)
            return (raw.categories || []).map((category: BudgetCategory) => ({ ...category, month })) as ImportBudgetCategory[]
          }),
        )
      setImportRows(rows)
      setImportBudgets(budgetResponses.flat())
      setImportMappings({})
      setImportFileName(file.name)
    } catch (e) {
      setImportRows([])
      setImportBudgets([])
      setImportMappings({})
      setImportFileName('')
      setError(e instanceof Error ? e.message : 'File Selow.id belum dapat dibaca')
    } finally {
      setParsingImport(false)
    }
  }
  async function importSelowTransactions(formData: FormData) {
    if (!importDeposit || !importReady) return
    setSaving(true)
    setError('')
    try {
      const response = await fetch(`/api/deposits/${importDeposit.id}/import-selow`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceAccountId: importTopupTotal > 0 ? String(formData.get('sourceAccountId')) || undefined : undefined,
            overrideReason: String(formData.get('overrideReason')).trim() || undefined,
            rows: importRows.map((row) => ({
              transactionDate: row.transactionDate,
              transactionTime: row.transactionTime,
              note: row.note || undefined,
              amount: row.amount,
              budgetCategoryId: row.amount < 0 ? importMappings[`${row.transactionDate.slice(0, 7)}|${row.merchant}`] : undefined,
            })),
          }),
        }),
        result = (await response.json().catch(() => ({}))) as SelowImportResult & { error?: string }
      if (!response.ok) throw new Error(result.error || 'Transaksi Selow.id belum dapat diimpor')
      await refresh()
      setImportResult(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Terjadi kesalahan')
    } finally {
      setSaving(false)
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="KUMPULAN KARTU VIRTUAL"
        title="VCC & saldo deposit"
        description="Kelola setiap VCC Selow.id, saldo, top-up, debit, RAB, dan rekonsiliasinya."
        action={
          canManage ? (
            <Button onClick={() => { setError(''); setNewVccNumber(''); setCreateDeposit(true) }}><Plus size={16} /> Tambah VCC</Button>
          ) : undefined
        }
      />
      {error && !action && !editingDeposit && (
        <div className="budget-alert error">
          <span>{error}</span>
          <button onClick={() => setError('')}>Tutup</button>
        </div>
      )}
      <div className="deposit-hero">
        <div>
          <span>Total saldo seluruh VCC</span>
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
      <Card className="deposit-flow-card">
        <div className="deposit-flow-step"><span><WalletCards size={19}/></span><div><strong>1. Top-up Selow.id</strong><small>Rekening perusahaan berkurang, deposit bertambah. Belum menjadi biaya.</small></div></div>
        <ArrowRight size={18}/>
        <div className="deposit-flow-step"><span><ReceiptText size={19}/></span><div><strong>2. Catat debit VCC</strong><small>Pilih RAB sesuai tujuan, misalnya Facebook Ads atau server.</small></div></div>
        <ArrowRight size={18}/>
        <div className="deposit-flow-step"><span><ClipboardCheck size={19}/></span><div><strong>3. Cocokkan saldo</strong><small>Bandingkan saldo sistem dengan saldo aktual di provider.</small></div></div>
      </Card>
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
                  <span>{deposit.accountName || 'Selow.id'}{deposit.maskedNumber ? ` · ${deposit.maskedNumber}` : ''}</span>
                </div>
                {low ? (
                  <Badge tone="danger">
                    <AlertTriangle size={12} /> Saldo rendah
                  </Badge>
                ) : (
                  <Badge tone={deposit.reconciled ? 'success' : 'warning'}>{deposit.reconciled ? 'Saldo cocok' : 'Perlu dicocokkan'}</Badge>
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
                <div>
                  <span>Rekonsiliasi terakhir</span>
                  <strong>{deposit.lastReconciledAt ? formatDate(deposit.lastReconciledAt) : 'Belum pernah'}</strong>
                </div>
                <div>
                  <span>Selisih terakhir</span>
                  <strong className={Math.abs(deposit.reconciliationDifference || 0) > 0.005 ? 'negative' : 'positive'}>{formatIDR(deposit.reconciliationDifference || 0)}</strong>
                </div>
              </div>
              {canManage && (
                <div className="page-actions">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setError('')
                      setEditingDeposit(accounts.find((account) => account.id === deposit.id) || null)
                    }}
                  >
                    <Pencil size={15} /> Edit
                  </Button>
                  <Button variant="secondary" onClick={() => { setError(''); setDeleteTarget(accounts.find((item) => item.id === deposit.id) || null) }}>
                    <Trash2 size={15} /> Hapus
                  </Button>
                  <Button variant="secondary" onClick={() => { setError(''); setImportDeposit(deposit); setImportRows([]); setImportResult(null) }}>
                    <FileUp size={15} /> Impor Selow
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setError('')
                      setAction({ kind: 'usage', deposit })
                    }}
                  >
                    <ArrowUpRight size={15} /> Catat debit VCC
                  </Button>
                  <Button variant="secondary" onClick={() => { setError(''); setStatementBalance(deposit.balance); setReconcileDeposit(deposit) }}>
                    <ClipboardCheck size={15}/> Cocokkan saldo
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
            <strong>Belum ada VCC</strong>
            <span>Tambahkan kartu virtual Selow.id, lalu catat top-up dari rekening perusahaan.</span>
            {canManage && (
              <Button
                onClick={() => {
                  setError('')
                  setCreateDeposit(true)
                }}
              >
                <Plus size={15} /> Tambah VCC pertama
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
      {editingDeposit && (
        <Modal
          title={`Edit VCC ${editingDeposit.name}`}
          description="Ubah label kartu dan empat digit terakhir tanpa mengubah saldo."
          onClose={() => {
            setEditingDeposit(null)
            setError('')
          }}
        >
          <form className="form-grid" action={updateDeposit}>
            {error && <div className="auth-error span-2">{error}</div>}
            <label>
              Nama/fungsi VCC
              <input name="name" required minLength={2} maxLength={100} defaultValue={editingDeposit.name} />
            </label>
            <label>
              Provider
              <input name="institution" maxLength={100} defaultValue={editingDeposit.institution} />
            </label>
            <label>
              4 digit terakhir VCC
              <input name="maskedNumber" inputMode="numeric" pattern="[0-9]{4}" minLength={4} maxLength={4} defaultValue={lastFour(editingDeposit.maskedNumber)} placeholder="1234" required />
              <small>Nomor lengkap, CVV, dan masa berlaku tidak disimpan.</small>
            </label>
            <label>
              Batas saldo minimum
              <input name="lowBalanceThreshold" type="number" min="0" step="1000" defaultValue={editingDeposit.lowBalanceThreshold || 0} />
            </label>
            <label className="span-2">
              Warna indikator
              <input className="color-input" name="color" type="color" defaultValue={editingDeposit.color} />
            </label>
            <div className="modal-actions span-2">
              <Button variant="danger" onClick={() => { setError(''); setDeleteTarget(editingDeposit) }} disabled={saving}>
                <Trash2 size={15} /> Hapus
              </Button>
              <Button variant="secondary" onClick={() => setEditingDeposit(null)}>
                Batal
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Menyimpan…' : 'Simpan perubahan'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {importDeposit && (
        <Modal
          className="selow-import-modal"
          title={`Impor transaksi ${importDeposit.platform}`}
          description="Gunakan file Excel hasil Export pada halaman Card Details Selow.id."
          onClose={() => !saving && closeSelowImport()}
        >
          {importResult ? (
            <div className="selow-import-result">
              <span className="selow-import-success"><CheckCircle2 size={28}/></span>
              <h3>Impor selesai</h3>
              <p>Saldo VCC, transaksi, dan realisasi RAB telah diperbarui.</p>
              <div className="selow-result-grid">
                <div><strong>{importResult.imported}</strong><span>transaksi baru</span></div>
                <div><strong>{importResult.matched}</strong><span>cocok dengan catatan lama</span></div>
                <div><strong>{importResult.duplicates}</strong><span>duplikat dilewati</span></div>
              </div>
              <div className="modal-actions"><Button onClick={closeSelowImport}>Selesai</Button></div>
            </div>
          ) : (
            <form className="form-grid selow-import-form" action={importSelowTransactions}>
              {error && <div className="auth-error span-2">{error}</div>}
              <label className="selow-file-field span-2">
                <FileSpreadsheet size={22}/>
                <span><strong>{importFileName || 'Pilih export Selow.id'}</strong><small>Format .xlsx, maksimal 5 MB dan 2.000 transaksi.</small></span>
                <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => void loadSelowFile(event.target.files?.[0])}/>
              </label>
              {parsingImport && <div className="selow-import-loading span-2">Membaca dan memvalidasi file…</div>}
              {importRows.length > 0 && (
                <>
                  <div className="selow-import-summary span-2">
                    <div><span>Periode</span><strong>{importRows[0].transactionDate} — {importRows.at(-1)?.transactionDate}</strong></div>
                    <div><span>Jumlah baris</span><strong>{importRows.length}</strong></div>
                    <div><span>Top-up</span><strong className="positive">{formatIDR(importTopupTotal)}</strong></div>
                    <div><span>Debit</span><strong className="negative">{formatIDR(importDebitTotal)}</strong></div>
                  </div>
                  {importTopupTotal > 0 && (sources.length ? (
                    <label className="span-2">Rekening sumber untuk top-up
                      <select name="sourceAccountId" defaultValue="" required>
                        <option value="" disabled>Pilih rekening sumber</option>
                        {sources.map((account) => <option value={account.id} key={account.id}>{account.name} — saldo {formatIDR(account.balance)}</option>)}
                      </select>
                      <small>Total top-up {formatIDR(importTopupTotal)} akan mengurangi rekening ini.</small>
                    </label>
                  ) : <div className="deposit-source-empty span-2"><AlertTriangle size={19}/><span><strong>Belum ada rekening sumber</strong><small>Tambahkan rekening sebelum mengimpor top-up Selow.id.</small></span><Button variant="secondary" onClick={()=>navigate('/rekening')}>Buka Rekening</Button></div>)}
                  <fieldset className="selow-rab-map span-2">
                    <legend>Pemetaan debit ke RAB</legend>
                    <p>Satu merchant dapat diarahkan ke pos RAB berbeda. Sistem memastikan periodenya sama dengan tanggal transaksi.</p>
                    {importGroups.map((group) => {
                      const [month, merchant] = group.split('|'),
                        rowCount = importRows.filter((row) => row.amount < 0 && row.transactionDate.startsWith(month) && row.merchant === merchant).length,
                        total = importRows.filter((row) => row.amount < 0 && row.transactionDate.startsWith(month) && row.merchant === merchant).reduce((sum, row) => sum + Math.abs(row.amount), 0),
                        options = importBudgets.filter((category) => category.month === month)
                      return <div className="selow-rab-row" key={group}><span><strong>{merchant}</strong><small>{month} · {rowCount} transaksi · {formatIDR(total)}</small></span><select aria-label={`RAB ${merchant} ${month}`} value={importMappings[group] || ''} onChange={(event)=>setImportMappings((current)=>({...current,[group]:event.target.value}))} required><option value="" disabled>Pilih pos RAB</option>{options.map((category)=><option value={category.id} key={category.id}>{category.name} — sisa {formatIDR(category.plannedAmount-category.actual-category.pendingAmount-category.committedAmount)}</option>)}</select></div>
                    })}
                    {!importGroups.length && <div className="selow-map-empty">Tidak ada debit yang perlu dipetakan.</div>}
                  </fieldset>
                  <label className="span-2">Alasan override RAB <span className="optional-label">Jika diperlukan</span><input name="overrideReason" maxLength={500} placeholder="Diisi jika realisasi melebihi sisa anggaran"/></label>
                  <div className="selow-preview span-2"><div><strong>Pratinjau transaksi</strong><span>Menampilkan {Math.min(6, importRows.length)} dari {importRows.length} baris</span></div>{importRows.slice(0,6).map((row,index)=><div className="selow-preview-row" key={`${row.transactionDate}-${row.transactionTime}-${index}`}><span>{row.transactionDate}<small>{row.transactionTime}</small></span><span>{row.note || 'Top-up Selow.id'}</span><strong className={row.amount>0?'positive':'negative'}>{row.amount>0?'+':''}{formatIDR(row.amount)}</strong></div>)}</div>
                  <div className="vcc-security-note span-2"><ShieldCheck size={19}/><span><strong>Impor aman dan tidak menggandakan data</strong><small>File dibaca di perangkat Anda. Server hanya menerima tanggal, catatan, nominal, dan RAB. Catatan manual dengan tanggal dan nominal yang persis sama akan dicocokkan; catatan perkiraan yang berbeda perlu dibatalkan terlebih dahulu.</small></span></div>
                </>
              )}
              <div className="modal-actions span-2"><Button variant="secondary" onClick={closeSelowImport} disabled={saving}>Batal</Button><Button type="submit" disabled={saving||parsingImport||!importReady||(importTopupTotal>0&&!sources.length)}>{saving?'Mengimpor…':`Impor ${importRows.length||''} transaksi`}</Button></div>
            </form>
          )}
        </Modal>
      )}
      {createDeposit && (
        <Modal
          title="Tambah VCC Selow.id"
          description="Nomor lengkap hanya diproses di perangkat ini untuk mengambil 4 digit terakhir."
          onClose={() => {
            setCreateDeposit(false)
            setNewVccNumber('')
            setError('')
          }}
        >
          <form className="form-grid" action={createDepositAccount}>
            {error && <div className="auth-error span-2">{error}</div>}
            <label>
              Nama/fungsi VCC
              <input name="platform" required minLength={2} maxLength={100} placeholder="Facebook Ads Utama" />
            </label>
            <label>
              Provider
              <input name="institution" required minLength={2} maxLength={100} defaultValue="Selow.id" />
            </label>
            <label>
              Nomor VCC
              <input name="vccNumber" inputMode="numeric" autoComplete="off" minLength={4} maxLength={24} value={newVccNumber} onChange={event=>setNewVccNumber(event.target.value.replace(/[^0-9 -]/g,''))} placeholder="Masukkan nomor VCC" required />
              <small>Hanya 4 digit terakhir yang dikirim dan disimpan. Jangan masukkan CVV.</small>
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
            <div className="vcc-security-note span-2"><WalletCards size={19}/><span><strong>Aman untuk identifikasi</strong><small>Sistem hanya menyimpan format •••• {lastFour(newVccNumber)||'1234'}. Nomor lengkap tidak pernah dikirim ke server.</small></span></div>
            <div className="form-note span-2">Saldo VCC dibuat Rp 0. Setelah kartu tersimpan, formulir top-up langsung terbuka.</div>
            <div className="modal-actions span-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setCreateDeposit(false)
                  setNewVccNumber('')
                  setError('')
                }}
              >
                Batal
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Membuat…' : 'Simpan VCC & top-up'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {action && (
        <Modal
          title={`${action.kind === 'topup' ? 'Top-up' : 'Catat debit VCC'} ${action.deposit.platform}`}
          description={action.kind === 'topup' ? 'Memindahkan dana dari rekening perusahaan ke aset deposit.' : 'Mengurangi deposit dan mengambil anggaran dari RAB.'}
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
                  Sumber anggaran RAB
                  <select name="budgetCategoryId" defaultValue="" required>
                    <option value="" disabled>Pilih pos RAB</option>
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
            <div className="form-note span-2">{action.kind === 'topup' ? 'Top-up memindahkan saldo rekening ke deposit, sehingga total aset perusahaan tetap sama.' : 'Debit VCC mengurangi saldo deposit, menjadi pengeluaran aktual, dan mengurangi sisa RAB.'}</div>
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
      <ConfirmActionModal
        open={Boolean(deleteTarget)}
        title="Hapus akun deposit?"
        subject={deleteTarget?.name || ''}
        detail={deleteTarget ? `${deleteTarget.institution || 'Platform deposit'} · saldo ${formatIDR(deleteTarget.balance)}` : ''}
        note="Akun deposit hanya dapat dihapus jika saldonya nol dan tidak memiliki transaksi efektif. Aktivitas lama tetap terlindungi dalam audit."
        confirmLabel="Hapus deposit"
        busy={saving}
        error={deleteTarget ? error : ''}
        onClose={() => { setDeleteTarget(null); setError('') }}
        onConfirm={() => void removeDeposit()}
      />
      {reconcileDeposit&&<Modal title={`Cocokkan saldo ${reconcileDeposit.platform}`} description="Masukkan saldo yang terlihat di dashboard provider saat ini." onClose={()=>{setReconcileDeposit(null);setError('')}}>
        <form className="form-grid" action={reconcileDepositBalance}>
          {error&&<div className="auth-error span-2">{error}</div>}
          <div className="deposit-reconcile-summary span-2"><div><span>Saldo menurut sistem</span><strong>{formatIDR(reconcileDeposit.balance)}</strong></div><div><span>Saldo aktual provider</span><strong>{formatIDR(statementBalance)}</strong></div><div className={Math.abs(statementBalance-reconcileDeposit.balance)>0.005?'difference':''}><span>Selisih</span><strong>{formatIDR(statementBalance-reconcileDeposit.balance)}</strong></div></div>
          <label>Tanggal pencocokan<input name="statementDate" type="date" defaultValue={today} required/></label>
          <label>Saldo aktual Selow.id<input name="statementBalance" type="number" min="0" step="1" value={statementBalance} onChange={event=>setStatementBalance(Number(event.target.value))} required/></label>
          <label className="span-2">Catatan <span className="optional-label">Opsional</span><textarea name="note" maxLength={500} placeholder="Contoh: saldo dilihat dari dashboard Selow.id"/></label>
          {Math.abs(statementBalance-reconcileDeposit.balance)>0.005?<div className="deposit-reconcile-warning span-2"><AlertTriangle size={18}/><span><strong>Ada debit yang belum tercatat</strong><small>Setelah menyimpan pencocokan, catat debit VCC sebesar selisih melalui RAB agar saldo sistem menjadi sama.</small></span></div>:<div className="income-journal-note span-2"><CheckCircle2 size={19}/><div><strong>Saldo sudah cocok</strong><span>Tidak ada debit VCC yang belum dicatat.</span></div></div>}
          <div className="modal-actions span-2"><Button variant="secondary" onClick={()=>setReconcileDeposit(null)}>Batal</Button><Button type="submit" disabled={saving}>{saving?'Menyimpan…':'Simpan pencocokan'}</Button></div>
        </form>
      </Modal>}
    </>
  )
}
