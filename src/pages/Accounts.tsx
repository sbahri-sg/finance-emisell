import { useState } from 'react'
import { CheckCircle2, CircleAlert, Landmark, MoreHorizontal, Plus, RefreshCw, Wallet } from 'lucide-react'
import { useFinance } from '../lib/FinanceContext'
import { formatCurrency, formatDate, formatIDR } from '../lib/format'
import { Badge, Button, Card, ConfirmActionModal, Modal, PageHeader } from '../components/ui'
import type { Account } from '../types'

const today = new Date().toISOString().slice(0, 10)
export function Accounts() {
  const { accounts, refresh, user } = useFinance(),
    [addModal, setAddModal] = useState(false),
    [editing, setEditing] = useState<Account | null>(null),
    [deleteTarget, setDeleteTarget] = useState<Account | null>(null),
    [reconcile, setReconcile] = useState<Account | null>(null),
    [saving, setSaving] = useState(false),
    [error, setError] = useState('')
  const visible = accounts.filter((account) => ['bank', 'cash', 'ewallet'].includes(account.kind)),
    liquid = visible,
    cash = liquid.reduce((sum, account) => sum + account.balance, 0),
    difference = visible.reduce((sum, account) => sum + Math.abs(account.reconciliationDifference || 0), 0)
  const canManage = !!user && ['owner', 'admin', 'finance'].includes(user.role)
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
      if (!response.ok) throw new Error(result.error || 'Data belum dapat disimpan')
      await refresh()
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Terjadi kesalahan')
      return false
    } finally {
      setSaving(false)
    }
  }
  async function editAccount(formData: FormData) {
    if (!editing) return
    const ok = await api(
      `/api/accounts/${editing.id}`,
      {
        name: String(formData.get('name')).trim(),
        institution: String(formData.get('institution')).trim() || undefined,
        kind: String(formData.get('kind')),
        maskedNumber: String(formData.get('maskedNumber')).trim() || undefined,
        currency: editing.currency,
        lowBalanceThreshold: Number(formData.get('lowBalanceThreshold')) || undefined,
        color: String(formData.get('color')),
      },
      'PATCH',
    )
    if (ok) setEditing(null)
  }
  async function removeAccount() {
    if (!deleteTarget) return
    const ok = await api(`/api/accounts/${deleteTarget.id}`, {}, 'DELETE')
    if (ok) { setDeleteTarget(null); setEditing(null) }
  }
  async function addAccount(formData: FormData) {
    const ok = await api('/api/accounts', {
      name: String(formData.get('name')).trim(),
      institution: String(formData.get('institution')).trim() || undefined,
      kind: String(formData.get('kind')),
      maskedNumber: String(formData.get('maskedNumber')).trim() || undefined,
      currency: String(formData.get('currency')),
      openingBalance: Number(formData.get('openingBalance')),
      lowBalanceThreshold: Number(formData.get('lowBalanceThreshold')) || undefined,
      color: String(formData.get('color')),
    })
    if (ok) setAddModal(false)
  }
  async function reconcileAccount(formData: FormData) {
    if (!reconcile) return
    const ok = await api(`/api/accounts/${reconcile.id}/reconcile`, {
      statementDate: String(formData.get('statementDate')),
      statementBalance: Number(formData.get('statementBalance')),
      note: String(formData.get('note')).trim() || undefined,
    })
    if (ok) setReconcile(null)
  }
  return (
    <>
      <PageHeader
        eyebrow="TREASURY"
        title="Rekening & saldo"
        description="Saldo buku dihitung dari jurnal dan dicocokkan dengan mutasi rekening."
        action={
          canManage ? (
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  setError('')
                  setReconcile(liquid[0] || null)
                }}
                disabled={!liquid.length}
              >
                <RefreshCw size={16} /> Rekonsiliasi
              </Button>
              <Button
                onClick={() => {
                  setError('')
                  setAddModal(true)
                }}
              >
                <Plus size={16} /> Tambah rekening
              </Button>
            </>
          ) : undefined
        }
      />
      {error && !addModal && !reconcile && !editing && (
        <div className="budget-alert error">
          <span>{error}</span>
          <button onClick={() => setError('')}>Tutup</button>
        </div>
      )}
      <div className="balance-hero">
        <div>
          <span>Total dana tersedia</span>
          <strong>{formatIDR(cash)}</strong>
          <small>Bank, kas, dan e-wallet</small>
        </div>
        <div className="balance-divider" />
        <div>
          <span>Rekening aktif</span>
          <strong>{visible.length}</strong>
          <small>{liquid.length} rekening likuid</small>
        </div>
        <div>
          <span>Selisih rekonsiliasi</span>
          <strong className={difference ? 'negative' : 'positive'}>{formatIDR(difference)}</strong>
          <small>{visible.filter((account) => account.reconciled).length} rekening sudah cocok</small>
        </div>
      </div>
      <div className="account-cards">
        {visible.map((account) => (
          <Card className="account-card" key={account.id}>
            <div className="account-card-top">
              <span className="large-account-icon" style={{ background: account.color }}>
                {account.kind === 'cash' ? <Wallet size={21} /> : <Landmark size={21} />}
              </span>
              {canManage ? (
                <button
                  className="icon-button"
                  onClick={() => {
                    setError('')
                    setEditing(account)
                  }}
                  aria-label={`Rekonsiliasi ${account.name}`}
                >
                  <MoreHorizontal size={20} />
                </button>
              ) : null}
            </div>
            <div className="account-name">
              <strong>{account.name}</strong>
              <span>
                {account.institution || 'Internal'}
                {account.maskedNumber ? ` · ${account.maskedNumber}` : ''}
              </span>
            </div>
            <div className="account-balance">
              <span>Saldo buku</span>
              <strong>{formatCurrency(account.balance, account.currency)}</strong>
            </div>
            <div className="account-card-bottom">
              <span>{account.lastReconciledAt ? `Terakhir ${formatDate(account.lastReconciledAt)}` : 'Belum direkonsiliasi'}</span>
              <Badge tone={account.reconciled ? 'success' : 'warning'}>
                {account.reconciled ? (
                  <>
                    <CheckCircle2 size={12} /> Cocok
                  </>
                ) : (
                  <>
                    <CircleAlert size={12} /> Perlu diperiksa
                  </>
                )}
              </Badge>
            </div>
          </Card>
        ))}
      </div>
      {!visible.length && (
        <Card className="reconcile-card">
          <div className="reconcile-icon">
            <Landmark size={25} />
          </div>
          <div>
            <h2>Belum ada rekening perusahaan</h2>
            <p>Tambahkan rekening bank atau kas sebelum mencatat pembayaran.</p>
          </div>
        </Card>
      )}
      {addModal && (
        <Modal
          title="Tambah rekening"
          description="Saldo awal akan dicatat sebagai jurnal pembukaan yang seimbang."
          onClose={() => {
            setAddModal(false)
            setError('')
          }}
        >
          <form className="form-grid" action={addAccount}>
            {error && <div className="auth-error span-2">{error}</div>}
            <label className="span-2">
              Nama rekening
              <input name="name" required minLength={2} maxLength={100} placeholder="BCA Operasional" />
            </label>
            <label>
              Jenis
              <select name="kind">
                <option value="bank">Rekening bank</option>
                <option value="cash">Kas tunai</option>
                <option value="ewallet">E-wallet</option>
              </select>
            </label>
            <label>
              Mata uang
              <select name="currency">
                <option value="IDR">IDR</option>
                <option value="USD">USD</option>
              </select>
            </label>
            <label>
              Bank/institusi
              <input name="institution" maxLength={100} />
            </label>
            <label>
              Nomor tersamarkan
              <input name="maskedNumber" maxLength={20} placeholder="•••• 1234" />
            </label>
            <label>
              Saldo awal
              <input name="openingBalance" type="number" min="0" step="1" defaultValue="0" required />
            </label>
            <label>
              Batas saldo minimum
              <input name="lowBalanceThreshold" type="number" min="0" step="1" defaultValue="0" />
            </label>
            <label>
              Warna
              <input className="color-input" name="color" type="color" defaultValue="#225c55" />
            </label>
            <div className="form-note span-2">Setelah dibuat, perubahan saldo harus melalui transaksi agar jejak audit tetap utuh.</div>
            <div className="modal-actions span-2">
              <Button variant="secondary" onClick={() => setAddModal(false)}>
                Batal
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Menyimpan…' : 'Tambah rekening'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {reconcile && (
        <Modal
          title={`Rekonsiliasi ${reconcile.name}`}
          description={`Saldo buku saat ini ${formatIDR(reconcile.balance)}`}
          onClose={() => {
            setReconcile(null)
            setError('')
          }}
        >
          <form className="form-grid" action={reconcileAccount}>
            {error && <div className="auth-error span-2">{error}</div>}
            <label>
              Tanggal mutasi
              <input name="statementDate" type="date" defaultValue={today} required />
            </label>
            <label>
              Saldo menurut bank/kas
              <input name="statementBalance" type="number" step="1" defaultValue={reconcile.balance} required />
            </label>
            <label className="span-2">
              Catatan <span className="optional-label">Opsional</span>
              <textarea name="note" maxLength={500} placeholder="Sumber mutasi atau penjelasan selisih" />
            </label>
            <div className="form-note span-2">Sistem menyimpan saldo buku, saldo laporan, selisih, waktu, dan petugas rekonsiliasi.</div>
            <div className="modal-actions span-2">
              <Button variant="secondary" onClick={() => setReconcile(null)}>
                Batal
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Mencocokkan…' : 'Simpan rekonsiliasi'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {editing && (
        <Modal
          title={`Edit ${editing.name}`}
          description="Saldo tidak dapat diubah dari sini; gunakan transaksi atau rekonsiliasi."
          onClose={() => {
            setEditing(null)
            setError('')
          }}
        >
          <form className="form-grid" action={editAccount}>
            {error && <div className="auth-error span-2">{error}</div>}
            <label className="span-2">
              Nama rekening
              <input name="name" required minLength={2} maxLength={100} defaultValue={editing.name} />
            </label>
            <label>
              Jenis
              <select name="kind" defaultValue={editing.kind}>
                <option value="bank">Rekening bank</option>
                <option value="cash">Kas tunai</option>
                <option value="ewallet">E-wallet</option>
              </select>
            </label>
            <label>
              Bank/institusi
              <input name="institution" maxLength={100} defaultValue={editing.institution} />
            </label>
            <label>
              Nomor tersamarkan
              <input name="maskedNumber" maxLength={20} defaultValue={editing.maskedNumber} />
            </label>
            <label>
              Batas saldo minimum
              <input name="lowBalanceThreshold" type="number" min="0" step="1" defaultValue={editing.lowBalanceThreshold || 0} />
            </label>
            <label>
              Warna
              <input className="color-input" name="color" type="color" defaultValue={editing.color} />
            </label>
            <div className="modal-actions span-2">
              <Button variant="danger" onClick={() => { setError(''); setDeleteTarget(editing) }} disabled={saving}>
                Hapus
              </Button>
              <Button variant="secondary" onClick={() => setEditing(null)}>
                Batal
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Menyimpan…' : 'Simpan perubahan'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
      <ConfirmActionModal
        open={Boolean(deleteTarget)}
        title="Hapus rekening?"
        subject={deleteTarget?.name || ''}
        detail={deleteTarget ? `${deleteTarget.institution || 'Kas perusahaan'} · saldo ${formatIDR(deleteTarget.balance)}` : ''}
        note="Rekening hanya dapat dihapus jika saldonya nol dan tidak memiliki transaksi efektif. Histori audit tidak ikut dihapus."
        confirmLabel="Hapus rekening"
        busy={saving}
        error={deleteTarget ? error : ''}
        onClose={() => { setDeleteTarget(null); setError('') }}
        onConfirm={() => void removeAccount()}
      />
    </>
  )
}
