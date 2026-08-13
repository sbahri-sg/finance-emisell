import { useCallback, useEffect, useMemo, useState } from 'react'
import { Banknote, CheckCircle2, CreditCard, Edit3, LockKeyhole, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { Badge, Button, Card, ConfirmActionModal, EmptyState, Modal, PageHeader } from '../components/ui'
import { MoneyInput } from '../components/MoneyInput'
import { useFinance } from '../lib/FinanceContext'
import { formatIDR } from '../lib/format'
import type { BudgetCategory, PayrollBatch } from '../types'

const currentMonth = new Date().toISOString().slice(0, 7)
const today = new Date().toISOString().slice(0, 10)

function monthLabel(month: string) {
  return new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }).format(new Date(`${month}-01T12:00:00+07:00`))
}

export function Payroll() {
  const { accounts, refresh } = useFinance()
  const [batches, setBatches] = useState<PayrollBatch[]>([])
  const [budgetCategories, setBudgetCategories] = useState<BudgetCategory[]>([])
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState<PayrollBatch | null>(null)
  const [payment, setPayment] = useState<PayrollBatch | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<PayrollBatch | null>(null)
  const [month, setMonth] = useState(currentMonth)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const paymentAccounts = accounts.filter((account) => ['bank', 'cash', 'ewallet'].includes(account.kind))

  const loadBatches = useCallback(async () => {
    const response = await fetch('/api/payroll', { credentials: 'include' })
    const body = await response.json().catch(() => ({ batches: [] }))
    if (!response.ok) throw new Error(body.error || 'Data payroll belum dapat dimuat')
    setBatches((body.batches || []).map((batch: PayrollBatch) => ({ ...batch, employeeCount: Number(batch.employeeCount), netPay: Number(batch.netPay) })))
  }, [])

  const loadBudget = useCallback(async (targetMonth: string) => {
    const response = await fetch(`/api/budgets?month=${targetMonth}`, { credentials: 'include' })
    const body = await response.json().catch(() => ({ categories: [] }))
    setBudgetCategories((body.categories || []).map((category: BudgetCategory) => ({ ...category, plannedAmount: Number(category.plannedAmount), actual: Number(category.actual), pendingAmount: Number(category.pendingAmount), committedAmount: Number(category.committedAmount) })))
  }, [])

  useEffect(() => { void loadBatches().catch((e) => setError(e instanceof Error ? e.message : 'Terjadi kesalahan')) }, [loadBatches])
  useEffect(() => { if (modal) void loadBudget(month) }, [loadBudget, modal, month])

  const summary = useMemo(() => ({
    ready: batches.filter((batch) => batch.status === 'ready').reduce((sum, batch) => sum + batch.netPay, 0),
    paid: batches.filter((batch) => batch.status === 'paid').reduce((sum, batch) => sum + batch.netPay, 0),
    current: batches.find((batch) => batch.month === currentMonth),
  }), [batches])

  function openCreate() {
    setEditing(null); setMonth(currentMonth); setError(''); setModal(true)
  }
  function openEdit(batch: PayrollBatch) {
    setEditing(batch); setMonth(batch.month); setError(''); setModal(true)
  }

  async function saveBatch(formData: FormData) {
    setSaving(true); setError('')
    try {
      const payload = {
        month: String(formData.get('month')),
        employeeCount: Number(formData.get('employeeCount')),
        netPay: Number(formData.get('netPay')),
        budgetCategoryId: String(formData.get('budgetCategoryId')),
        notes: String(formData.get('notes')).trim() || undefined,
        overrideReason: String(formData.get('overrideReason')).trim() || undefined,
      }
      const response = await fetch(editing ? `/api/payroll/${editing.id}` : '/api/payroll', { method: editing ? 'PATCH' : 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || 'Batch payroll belum dapat disimpan')
      await Promise.all([loadBatches(), refresh()]); setModal(false); setEditing(null)
    } catch (e) { setError(e instanceof Error ? e.message : 'Terjadi kesalahan') } finally { setSaving(false) }
  }

  async function payBatch(formData: FormData) {
    if (!payment) return
    setSaving(true); setError('')
    try {
      const payload = { transactionDate: String(formData.get('transactionDate')), accountId: String(formData.get('accountId')), reference: String(formData.get('reference')).trim() || undefined, proofUrl: String(formData.get('proofUrl')).trim() || undefined, overrideReason: String(formData.get('overrideReason')).trim() || undefined }
      const response = await fetch(`/api/payroll/${payment.id}/pay`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || 'Pembayaran payroll belum dapat dicatat')
      await Promise.all([loadBatches(), refresh()]); setPayment(null)
    } catch (e) { setError(e instanceof Error ? e.message : 'Terjadi kesalahan') } finally { setSaving(false) }
  }

  async function removeBatch() {
    if (!deleteTarget) return
    setSaving(true); setError('')
    try {
      const response = await fetch(`/api/payroll/${deleteTarget.id}`, { method: 'DELETE', credentials: 'include' })
      const body = response.status === 204 ? {} : await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.error || 'Batch payroll belum dapat dihapus')
      await loadBatches(); setDeleteTarget(null)
    } catch (e) { setError(e instanceof Error ? e.message : 'Terjadi kesalahan') } finally { setSaving(false) }
  }

  return <>
    <PageHeader eyebrow="Kompensasi" title="Payroll" description="Catat total net pay final dari platform payroll tanpa menyimpan rincian gaji per staf." action={<Button onClick={openCreate}><Plus size={16}/> Catat total payroll</Button>}/>
    <div className="payroll-privacy-note"><ShieldCheck size={20}/><div><strong>Ringkasan finansial saja</strong><span>Emisell Finance hanya menyimpan periode, jumlah staf, dan total setelah tunjangan serta potongan. Rincian staf tetap terlindungi di platform payroll.</span></div></div>
    {error&&!modal&&!payment&&!deleteTarget&&<div className="auth-error">{error}</div>}
    <div className="mini-stats three payroll-stats">
      <Card><span>Payroll bulan ini</span><strong>{summary.current ? formatIDR(summary.current.netPay) : 'Belum dicatat'}</strong><small>{summary.current ? `${summary.current.employeeCount} staf · ${summary.current.status === 'paid' ? 'Lunas' : 'Menunggu pembayaran'}` : monthLabel(currentMonth)}</small></Card>
      <Card><span>Menunggu pembayaran</span><strong>{formatIDR(summary.ready)}</strong><small>{batches.filter((batch)=>batch.status==='ready').length} batch mencadangkan RAB</small></Card>
      <Card><span>Total telah dibayar</span><strong>{formatIDR(summary.paid)}</strong><small>{batches.filter((batch)=>batch.status==='paid').length} batch tercatat di jurnal</small></Card>
    </div>
    <Card className="payroll-list-card">
      <div className="card-heading"><div><h2>Riwayat batch payroll</h2><p>Satu periode menjadi satu transaksi pengeluaran saat dibayar.</p></div></div>
      {batches.length ? <div className="table-scroll"><table><thead><tr><th>Periode</th><th>Jumlah staf</th><th>RAB</th><th>Status</th><th>Pembayaran</th><th className="align-right">Net pay</th><th>Tindakan</th></tr></thead><tbody>{batches.map((batch)=><tr key={batch.id}><td><strong>{monthLabel(batch.month)}</strong><small className="table-subtext">Dibuat oleh {batch.createdBy}</small></td><td>{batch.employeeCount} staf</td><td>{batch.budgetCategory}</td><td><Badge tone={batch.status==='paid'?'success':'warning'}>{batch.status==='paid'?'Lunas':'Siap dibayar'}</Badge></td><td>{batch.status==='paid'?<span><strong>{batch.paidFrom}</strong><small className="table-subtext">{batch.paidAt}{batch.paymentReference?` · ${batch.paymentReference}`:''}</small></span>:<span className="muted">Belum dibayar</span>}</td><td className="align-right amount"><strong>{formatIDR(batch.netPay)}</strong></td><td><div className="payroll-actions">{batch.status==='ready'?<><button aria-label={`Edit payroll ${batch.month}`} onClick={()=>openEdit(batch)}><Edit3 size={15}/></button><button aria-label={`Hapus payroll ${batch.month}`} onClick={()=>{setError('');setDeleteTarget(batch)}}><Trash2 size={15}/></button><Button onClick={()=>{setError('');setPayment(batch)}}><CreditCard size={15}/> Bayar</Button></>:batch.proofUrl?<a href={batch.proofUrl} target="_blank" rel="noreferrer">Bukti</a>:<CheckCircle2 size={18}/>}</div></td></tr>)}</tbody></table></div>:<EmptyState title="Belum ada batch payroll" description="Masukkan total net pay final setelah payroll dikunci di platform sumber."/>}
    </Card>

    {modal&&<Modal title={editing?'Edit total payroll':'Catat total payroll'} description="Gunakan angka Net Pay final dari platform payroll." onClose={()=>{setModal(false);setEditing(null);setError('')}}>
      <form className="form-grid" action={saveBatch}>{error&&<div className="auth-error span-2">{error}</div>}
        <label>Periode payroll<input name="month" type="month" value={month} onChange={(event)=>setMonth(event.target.value)} required/></label>
        <label>Jumlah staf<input name="employeeCount" type="number" min="1" max="10000" defaultValue={editing?.employeeCount||''} required/></label>
        <label className="span-2">Total Net Pay<MoneyInput name="netPay" min="1" defaultValue={editing?.netPay} required/><small>Isi total setelah tunjangan, bonus, pajak, dan seluruh potongan.</small></label>
        <label className="span-2">Pos RAB<select name="budgetCategoryId" defaultValue={editing?.budgetCategoryId||''} required><option value="" disabled>Pilih pos anggaran gaji</option>{budgetCategories.map((category)=><option value={category.id} key={category.id}>{category.name} — sisa {formatIDR(category.plannedAmount-category.actual-category.pendingAmount-category.committedAmount+(editing?.budgetCategoryId===category.id?editing.netPay:0))}</option>)}</select><small>Total payroll dicadangkan sampai pembayaran dilakukan.</small></label>
        <label className="span-2">Catatan <span className="optional-label">Opsional</span><textarea name="notes" maxLength={500} defaultValue={editing?.notes} placeholder="Contoh: hasil payroll yang sudah dikunci"/></label>
        <label className="span-2">Alasan melebihi RAB <span className="optional-label">Jika diperlukan</span><textarea name="overrideReason" minLength={5} maxLength={500}/></label>
        <div className="payroll-total-check span-2"><LockKeyhole size={20}/><div><strong>Tidak dihitung ulang</strong><span>Nominal ini akan digunakan apa adanya sebagai total pembayaran dan realisasi RAB.</span></div></div>
        <div className="modal-actions span-2"><Button variant="secondary" onClick={()=>setModal(false)}>Batal</Button><Button type="submit" disabled={saving||!budgetCategories.length}>{saving?'Menyimpan…':editing?'Simpan perubahan':'Simpan batch'}</Button></div>
      </form>
    </Modal>}

    {payment&&<Modal title={`Bayar payroll ${monthLabel(payment.month)}`} description={`${payment.employeeCount} staf · total final ${formatIDR(payment.netPay)}`} onClose={()=>{setPayment(null);setError('')}}>
      <form className="form-grid" action={payBatch}>{error&&<div className="auth-error span-2">{error}</div>}
        <label>Tanggal pembayaran<input name="transactionDate" type="date" defaultValue={today} required/></label>
        <label>Nominal final<MoneyInput name="netPayDisplay" value={payment.netPay} readOnly/></label>
        <label className="span-2">Rekening pembayaran<select name="accountId" defaultValue="" required><option value="" disabled>Pilih rekening</option>{paymentAccounts.map((account)=><option value={account.id} key={account.id}>{account.name} — saldo {formatIDR(account.balance)}</option>)}</select></label>
        <label>Referensi transfer <span className="optional-label">Opsional</span><input name="reference" maxLength={100}/></label>
        <label>Link bukti pembayaran <span className="optional-label">Opsional</span><input name="proofUrl" type="url" maxLength={500} placeholder="https://..."/></label>
        <label className="span-2">Alasan override RAB <span className="optional-label">Jika diperlukan</span><textarea name="overrideReason" minLength={5} maxLength={500}/></label>
        <div className="payroll-payment-note span-2"><Banknote size={20}/><div><strong>Satu pembayaran, satu jurnal</strong><span>Saldo rekening berkurang {formatIDR(payment.netPay)} dan cadangan RAB berubah menjadi realisasi dengan nilai yang sama.</span></div></div>
        <div className="modal-actions span-2"><Button variant="secondary" onClick={()=>setPayment(null)}>Batal</Button><Button type="submit" disabled={saving}>{saving?'Memproses…':'Catat pembayaran payroll'}</Button></div>
      </form>
    </Modal>}
    <ConfirmActionModal open={Boolean(deleteTarget)} title="Hapus batch payroll?" subject={deleteTarget?`Payroll ${monthLabel(deleteTarget.month)}`:''} detail={deleteTarget?`${deleteTarget.employeeCount} staf · ${formatIDR(deleteTarget.netPay)}`:''} note="Batch belum dibayar akan dihapus dan cadangan RAB dilepas. Tidak ada saldo rekening yang berubah." confirmLabel="Hapus batch" busy={saving} error={deleteTarget?error:''} onClose={()=>{setDeleteTarget(null);setError('')}} onConfirm={()=>void removeBatch()}/>
  </>
}
