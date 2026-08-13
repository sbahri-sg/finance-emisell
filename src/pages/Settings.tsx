import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Bell, Building2, CheckCircle2, Database, Download, FileDown, KeyRound, Landmark, LockKeyhole, LogOut, Pencil, Plus, Save, ShieldCheck, SlidersHorizontal, Tags, Trash2, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Badge, Button, Card, Modal, PageHeader } from '../components/ui'
import { MoneyInput } from '../components/MoneyInput'
import { useFinance } from '../lib/FinanceContext'
import { formatCurrency } from '../lib/format'
import type { ExpenseCategoryLabel } from '../types'

type Tab='company'|'finance'|'notifications'|'approval'|'security'|'data'
type SettingsData={
  profile:{name:string;legalName:string;taxId:string;financeEmail:string;address:string;timezone:string;baseCurrency:'IDR'|'USD'}
  settings:{defaultAccountId:string;transactionPrefix:string;purchasePrefix:string;minimumCashBalance:number;billReminderDays:number;notifyBills:boolean;notifyLowDeposit:boolean;notifyPurchaseApproval:boolean;notifyReconciliation:boolean;ownerApprovalThreshold:number;sessionHours:number;updatedAt:string}
  accounts:Array<{id:string;name:string;kind:string}>
  expenseCategories:ExpenseCategoryLabel[]
  canAdmin:boolean
}
type Session={id:string;createdAt:string;lastSeenAt:string;expiresAt:string;current:boolean}
type Backup={id:string;createdAt:string;itemCount:number;createdBy:string}

const tabs:Array<{id:Tab;label:string;icon:LucideIcon}>=[
  {id:'company',label:'Perusahaan',icon:Building2},{id:'finance',label:'Preferensi keuangan',icon:Landmark},{id:'notifications',label:'Notifikasi',icon:Bell},{id:'approval',label:'Persetujuan',icon:SlidersHorizontal},{id:'security',label:'Keamanan',icon:LockKeyhole},{id:'data',label:'Data & backup',icon:Database},
]
const dateTime=(value:string)=>new Intl.DateTimeFormat('id-ID',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value))
const categoryActiveUsage=(category:ExpenseCategoryLabel)=>(category.transactionCount||0)+(category.budgetCount||0)

export function Settings(){
  const navigate=useNavigate(),{user,refresh}=useFinance()
  const [active,setActive]=useState<Tab>('company')
  const [data,setData]=useState<SettingsData|null>(null)
  const [sessions,setSessions]=useState<Session[]>([])
  const [backups,setBackups]=useState<Backup[]>([])
  const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false)
  const [message,setMessage]=useState(''),[error,setError]=useState('')
  const [editingCategoryId,setEditingCategoryId]=useState<string|null>(null)
  const [deleteCategoryTarget,setDeleteCategoryTarget]=useState<ExpenseCategoryLabel|null>(null)
  const [replacementCategoryId,setReplacementCategoryId]=useState('')
  const canFinance=['owner','admin','finance'].includes(user?.role||'')

  const load=useCallback(async()=>{setLoading(true);setError('');try{const response=await fetch('/api/settings',{credentials:'include'}),body=await response.json() as SettingsData&{error?:string};if(!response.ok)throw new Error(body.error||'Pengaturan belum dapat dimuat');body.settings.minimumCashBalance=Number(body.settings.minimumCashBalance);body.settings.ownerApprovalThreshold=Number(body.settings.ownerApprovalThreshold);setData(body)}catch(e){setError(e instanceof Error?e.message:'Terjadi kesalahan')}finally{setLoading(false)}},[])
  const loadSessions=useCallback(async()=>{const response=await fetch('/api/auth/sessions',{credentials:'include'});if(response.ok)setSessions(((await response.json()) as {sessions:Session[]}).sessions)},[])
  const loadBackups=useCallback(async()=>{if(!data?.canAdmin)return;const response=await fetch('/api/backups',{credentials:'include'});if(response.ok)setBackups(((await response.json()) as {backups:Backup[]}).backups)},[data?.canAdmin])
  useEffect(()=>{void load();void loadSessions()},[load,loadSessions])
  useEffect(()=>{if(active==='data')void loadBackups()},[active,loadBackups])

  async function request(url:string,method:string,payload?:unknown){setSaving(true);setError('');setMessage('');try{const response=await fetch(url,{method,credentials:'include',headers:payload?{'Content-Type':'application/json'}:undefined,body:payload?JSON.stringify(payload):undefined}),body=await response.json().catch(()=>({})) as {error?:string};if(!response.ok)throw new Error(body.error||'Perubahan belum dapat disimpan');setMessage('Perubahan berhasil disimpan.');return true}catch(e){setError(e instanceof Error?e.message:'Terjadi kesalahan');return false}finally{setSaving(false)}}
  async function saveProfile(form:FormData){const ok=await request('/api/settings/profile','PATCH',{name:String(form.get('name')),legalName:String(form.get('legalName')),taxId:String(form.get('taxId')),financeEmail:String(form.get('financeEmail')),address:String(form.get('address')),timezone:String(form.get('timezone')),baseCurrency:String(form.get('baseCurrency'))});if(ok){await load();await refresh()}}
  async function saveFinance(form:FormData){const ok=await request('/api/settings/preferences','PATCH',{defaultAccountId:String(form.get('defaultAccountId')),transactionPrefix:String(form.get('transactionPrefix')),purchasePrefix:String(form.get('purchasePrefix')),minimumCashBalance:Number(form.get('minimumCashBalance'))});if(ok)await load()}
  async function saveNotifications(form:FormData){const ok=await request('/api/settings/notifications','PATCH',{billReminderDays:Number(form.get('billReminderDays')),notifyBills:form.get('notifyBills')==='on',notifyLowDeposit:form.get('notifyLowDeposit')==='on',notifyPurchaseApproval:form.get('notifyPurchaseApproval')==='on',notifyReconciliation:form.get('notifyReconciliation')==='on'});if(ok)await load()}
  async function saveGovernance(form:FormData){const ok=await request('/api/settings/governance','PATCH',{ownerApprovalThreshold:Number(form.get('ownerApprovalThreshold')),sessionHours:Number(form.get('sessionHours'))});if(ok)await load()}
  async function saveExpenseCategory(form:FormData){const id=String(form.get('id')||'');const current=data?.expenseCategories.find(item=>item.id===id);const ok=await request(id?`/api/expense-categories/${id}`:'/api/expense-categories',id?'PATCH':'POST',{name:String(form.get('name')).trim(),color:String(form.get('color')),active:current?.active});if(ok){setEditingCategoryId(null);await load();(document.getElementById('new-expense-category') as HTMLFormElement|null)?.reset()}}
  async function toggleExpenseCategory(category:ExpenseCategoryLabel){if(await request(`/api/expense-categories/${category.id}`,'PATCH',{name:category.name,color:category.color,active:!category.active}))await load()}
  function openDeleteExpenseCategory(category:ExpenseCategoryLabel){setDeleteCategoryTarget(category);setReplacementCategoryId('');setError('');setMessage('')}
  async function deleteExpenseCategory(){if(!deleteCategoryTarget)return;const needsReplacement=categoryActiveUsage(deleteCategoryTarget)>0;const ok=await request(`/api/expense-categories/${deleteCategoryTarget.id}`,'DELETE',needsReplacement?{replacementCategoryId}:{});if(ok){setDeleteCategoryTarget(null);setReplacementCategoryId('');await load()}}
  async function changePassword(form:FormData){const currentPassword=String(form.get('currentPassword')),newPassword=String(form.get('newPassword')),confirmation=String(form.get('confirmation'));if(newPassword!==confirmation){setError('Konfirmasi kata sandi baru tidak sama');return}const ok=await request('/api/auth/change-password','POST',{currentPassword,newPassword});if(ok){(document.getElementById('password-form') as HTMLFormElement)?.reset();await loadSessions()}}
  async function revokeOthers(){if(await request('/api/auth/sessions/others','DELETE'))await loadSessions()}
  async function createBackup(){if(await request('/api/backups','POST'))await loadBackups()}
  function chooseTab(tab:Tab){setActive(tab);setError('');setMessage('')}

  if(loading)return <><PageHeader eyebrow="ADMINISTRASI" title="Pengaturan" description="Menyiapkan konfigurasi workspace…"/><Card className="settings-loading">Memuat pengaturan…</Card></>
  if(!data)return <><PageHeader eyebrow="ADMINISTRASI" title="Pengaturan" description="Kelola konfigurasi workspace perusahaan."/><div className="budget-alert error">{error||'Pengaturan tidak tersedia'}<button onClick={()=>void load()}>Coba lagi</button></div></>
  const locked=!data.canAdmin

  return <>
    <PageHeader eyebrow="ADMINISTRASI" title="Pengaturan" description="Konfigurasi perusahaan, aturan kerja, keamanan, dan perlindungan data."/>
    {(error||message)&&<div className={`budget-alert ${error?'error':'success'}`}><span>{error||message}</span><button onClick={()=>{setError('');setMessage('')}}>Tutup</button></div>}
    <div className="settings-layout"><aside className="settings-nav" aria-label="Menu pengaturan">
      {tabs.map(item=>{const Icon=item.icon;return <button key={item.id} className={active===item.id?'active':''} onClick={()=>chooseTab(item.id)}><Icon size={17}/>{item.label}</button>})}
      <button onClick={()=>navigate('/tim')}><Users size={17}/> Tim & akses</button>
    </aside><div className="settings-content">
      {active==='company'&&<Card><SettingHeading title="Profil perusahaan" description="Dipakai pada laporan, ekspor, dan dokumen perusahaan." locked={locked}/><form className="form-grid" action={saveProfile}>
        <label>Nama tampilan<input name="name" defaultValue={data.profile.name} required minLength={2} maxLength={120} disabled={locked}/></label><label>Nama legal<input name="legalName" defaultValue={data.profile.legalName} maxLength={160} disabled={locked} placeholder="PT Emisell Indonesia"/></label>
        <label>NPWP<input name="taxId" defaultValue={data.profile.taxId} maxLength={40} disabled={locked} placeholder="00.000.000.0-000.000"/></label><label>Email finance<input name="financeEmail" type="email" defaultValue={data.profile.financeEmail} maxLength={254} disabled={locked} placeholder="finance@perusahaan.com"/></label>
        <label>Mata uang<select name="baseCurrency" defaultValue={data.profile.baseCurrency} disabled={locked}><option value="IDR">IDR — Rupiah</option><option value="USD">USD — Dollar</option></select></label><label>Zona waktu<select name="timezone" defaultValue={data.profile.timezone} disabled={locked}><option value="Asia/Jakarta">WIB — Jakarta</option><option value="Asia/Makassar">WITA — Makassar</option><option value="Asia/Jayapura">WIT — Jayapura</option></select></label>
        <label className="span-2">Alamat<textarea name="address" defaultValue={data.profile.address} maxLength={500} disabled={locked}/></label>{!locked&&<SaveActions saving={saving}/>}
      </form></Card>}

      {active==='finance'&&<><Card><SettingHeading title="Preferensi keuangan" description="Standar pencatatan yang dipakai seluruh tim." locked={locked}/><form className="form-grid" action={saveFinance}>
        <label className="span-2">Rekening utama<select name="defaultAccountId" defaultValue={data.settings.defaultAccountId} disabled={locked}><option value="">Belum ditentukan</option>{data.accounts.map(account=><option key={account.id} value={account.id}>{account.name}</option>)}</select><small>Menjadi pilihan awal saat mencatat pemasukan atau pengeluaran.</small></label>
        <label>Prefix transaksi<input name="transactionPrefix" defaultValue={data.settings.transactionPrefix} required minLength={2} maxLength={12} pattern="[A-Za-z0-9-]+" disabled={locked}/></label><label>Prefix pengajuan<input name="purchasePrefix" defaultValue={data.settings.purchasePrefix} required minLength={2} maxLength={12} pattern="[A-Za-z0-9-]+" disabled={locked}/></label>
        <label className="span-2">Batas minimum kas<MoneyInput name="minimumCashBalance" min="0" defaultValue={data.settings.minimumCashBalance} disabled={locked}/><small>Peringatan muncul jika total dana likuid melewati batas ini.</small></label>
        {!locked&&<SaveActions saving={saving}/>}
      </form></Card><Card className="settings-secondary-card"><SettingHeading title="Label kategori pengeluaran" description="Label dipakai untuk RAB, transaksi, pengajuan, dan pengelompokan laporan." locked={locked}/><div className="expense-category-settings">
        <div className="expense-category-list">{data.expenseCategories.map(category=>editingCategoryId===category.id?<form className="expense-category-edit" action={saveExpenseCategory} key={category.id}><input type="hidden" name="id" value={category.id}/><input name="color" type="color" defaultValue={category.color} disabled={locked}/><input name="name" required minLength={2} maxLength={80} defaultValue={category.name} disabled={locked}/><Button type="submit" disabled={saving||locked}><Save size={14}/> Simpan</Button><Button variant="secondary" onClick={()=>setEditingCategoryId(null)}>Batal</Button></form>:<div className={`expense-category-item ${category.active?'':'inactive'}`} key={category.id}><i style={{background:category.color}}/><span><strong>{category.name}</strong><small>{category.transactionCount||0} transaksi aktif{(category.historyCount||0)>0?` · ${category.historyCount} histori`:''} · {category.budgetCount||0} pos RAB{categoryActiveUsage(category)===0?' · dapat dihapus':!category.active?' · dapat digabung dan dihapus':''}</small></span><Badge tone={category.active?'success':'neutral'}>{category.active?'Aktif':'Nonaktif'}</Badge>{!locked&&<><button aria-label={`Edit ${category.name}`} onClick={()=>setEditingCategoryId(category.id)}><Pencil size={15}/></button><button className="category-delete" aria-label={`Hapus ${category.name}`} title={categoryActiveUsage(category)>0?'Gabungkan ke kategori lain lalu hapus':'Hapus kategori'} disabled={saving} onClick={()=>openDeleteExpenseCategory(category)}><Trash2 size={15}/></button><button className="category-toggle" onClick={()=>void toggleExpenseCategory(category)}>{category.active?'Nonaktifkan':'Aktifkan'}</button></>}</div>)}</div>
        {!locked&&<form id="new-expense-category" className="expense-category-create" action={saveExpenseCategory}><span><Tags size={19}/><strong>Tambah label baru</strong></span><input name="name" required minLength={2} maxLength={80} placeholder="Contoh: Pajak & Legal"/><input name="color" type="color" defaultValue="#4f78a5" aria-label="Warna kategori"/><Button type="submit" disabled={saving}><Plus size={15}/> Tambah</Button></form>}
      </div></Card></>}

      {active==='notifications'&&<Card><SettingHeading title="Notifikasi operasional" description="Tentukan kondisi yang perlu muncul sebagai perhatian tim." locked={locked}/><form className="settings-form-stack" action={saveNotifications}>
        <label className="settings-inline-field"><span><strong>Pengingat tagihan</strong><small>Tampilkan sebelum tanggal jatuh tempo.</small></span><select name="billReminderDays" defaultValue={data.settings.billReminderDays} disabled={locked}><option value="3">3 hari sebelumnya</option><option value="7">7 hari sebelumnya</option><option value="14">14 hari sebelumnya</option><option value="30">30 hari sebelumnya</option></select></label>
        <SettingToggle name="notifyBills" title="Tagihan dan renewal" description="Tagihan mendekati jatuh tempo atau terlambat." defaultChecked={data.settings.notifyBills} disabled={locked}/><SettingToggle name="notifyLowDeposit" title="Saldo deposit menipis" description="Deposit platform berada di bawah batas minimum." defaultChecked={data.settings.notifyLowDeposit} disabled={locked}/><SettingToggle name="notifyPurchaseApproval" title="Pengajuan menunggu persetujuan" description="Ada pengajuan belanja baru dari staff." defaultChecked={data.settings.notifyPurchaseApproval} disabled={locked}/><SettingToggle name="notifyReconciliation" title="Rekonsiliasi rekening" description="Saldo rekening belum dicocokkan." defaultChecked={data.settings.notifyReconciliation} disabled={locked}/>{!locked&&<SaveActions saving={saving}/>}
      </form></Card>}

      {active==='approval'&&<Card><SettingHeading title="Aturan persetujuan" description="Satu aturan sederhana agar transaksi besar tetap dikendalikan Owner." locked={locked}/><form className="form-grid" action={saveGovernance}>
        <label className="span-2">Wajib persetujuan Owner mulai nominal<MoneyInput name="ownerApprovalThreshold" min="0" defaultValue={data.settings.ownerApprovalThreshold} disabled={locked}/><small>Saat ini: {formatCurrency(data.settings.ownerApprovalThreshold,data.profile.baseCurrency)}. Nilai 0 menonaktifkan batas khusus Owner.</small></label>
        <label className="span-2">Durasi sesi login<select name="sessionHours" defaultValue={data.settings.sessionHours} disabled={locked}><option value="4">4 jam</option><option value="8">8 jam</option><option value="12">12 jam</option><option value="24">24 jam</option><option value="72">3 hari</option><option value="168">7 hari</option></select><small>Berlaku pada login berikutnya. Sesi aktif tidak otomatis diperpanjang.</small></label>{!locked&&<SaveActions saving={saving}/>}
      </form></Card>}

      {active==='security'&&<><Card><SettingHeading title="Ubah kata sandi" description="Kata sandi baru minimal 12 karakter."/><form id="password-form" className="form-grid" action={changePassword}>
        <label className="span-2">Kata sandi saat ini<input name="currentPassword" type="password" required minLength={12} maxLength={128} autoComplete="current-password"/></label><label>Kata sandi baru<input name="newPassword" type="password" required minLength={12} maxLength={128} autoComplete="new-password"/></label><label>Konfirmasi kata sandi<input name="confirmation" type="password" required minLength={12} maxLength={128} autoComplete="new-password"/></label><SaveActions saving={saving} label="Perbarui kata sandi" icon={<KeyRound size={15}/>}/>
      </form></Card><Card className="settings-secondary-card"><SettingHeading title="Sesi aktif" description="Perangkat yang masih memiliki akses ke akun ini."/><div className="session-list">{sessions.map(session=><div key={session.id}><span className={`session-icon ${session.current?'current':''}`}><ShieldCheck size={18}/></span><p><strong>{session.current?'Perangkat ini':'Sesi lain'}</strong><small>Aktif {dateTime(session.lastSeenAt)} · berakhir {dateTime(session.expiresAt)}</small></p>{session.current&&<Badge tone="success">Saat ini</Badge>}</div>)}</div>{sessions.some(item=>!item.current)&&<div className="settings-card-actions"><Button variant="secondary" onClick={()=>void revokeOthers()} disabled={saving}><LogOut size={15}/> Keluarkan sesi lain</Button></div>}</Card></>}

      {active==='data'&&<><Card><SettingHeading title="Ekspor data" description="Unduh transaksi untuk pemeriksaan atau pengolahan di spreadsheet."/><div className="settings-action-row"><span className="settings-action-icon"><FileDown size={21}/></span><p><strong>Transaksi CSV</strong><small>Semua transaksi beserta status, kategori, referensi, dan nominal.</small></p>{canFinance?<a className="button button-secondary" href="/api/exports/transactions.csv"><Download size={15}/> Unduh CSV</a>:<Badge tone="neutral">Khusus Finance</Badge>}</div></Card>
        <Card className="settings-secondary-card"><SettingHeading title="Backup perusahaan" description="Snapshot data tanpa kata sandi dan sesi login." locked={!data.canAdmin}/>{data.canAdmin&&<><div className="settings-backup-callout"><Database size={21}/><span><strong>Buat backup sebelum perubahan besar</strong><small>Maksimal 20 backup terakhir tersimpan. File dapat diunduh dalam format JSON.</small></span><Button onClick={()=>void createBackup()} disabled={saving}>{saving?'Memproses…':'Buat backup'}</Button></div><div className="backup-list">{backups.length===0?<div className="settings-empty">Belum ada backup.</div>:backups.map(backup=><div key={backup.id}><span><strong>{dateTime(backup.createdAt)}</strong><small>{backup.itemCount} data · oleh {backup.createdBy}</small></span><a className="button button-ghost" href={`/api/backups/${backup.id}/download`}><Download size={15}/> Unduh</a></div>)}</div></>}</Card></>}
    </div></div>
    {deleteCategoryTarget&&(()=>{const needsReplacement=categoryActiveUsage(deleteCategoryTarget)>0;const replacements=data.expenseCategories.filter(category=>category.id!==deleteCategoryTarget.id&&category.active);return <Modal title={needsReplacement?'Gabungkan & hapus kategori?':'Hapus kategori?'} description="Konfirmasi diperlukan sebelum label kategori dihapus" onClose={()=>!saving&&setDeleteCategoryTarget(null)}>
      {error&&<div className="auth-error delete-confirmation-error">{error}</div>}
      <div className="delete-confirmation"><span className="delete-confirmation-icon"><Trash2 size={25}/></span><div><strong>{deleteCategoryTarget.name}</strong><p>{needsReplacement?`${deleteCategoryTarget.transactionCount||0} transaksi aktif dan ${deleteCategoryTarget.budgetCount||0} pos RAB akan dipindahkan ke kategori pengganti.`:(deleteCategoryTarget.historyCount||0)>0?`${deleteCategoryTarget.historyCount} catatan histori tetap tersimpan dengan nama kategori lamanya.`:'Label belum digunakan dan dapat dihapus langsung.'}</p></div></div>
      {needsReplacement&&<label className="category-merge-field"><span>Kategori pengganti</span><select value={replacementCategoryId} onChange={event=>setReplacementCategoryId(event.target.value)} disabled={saving}><option value="">Pilih kategori tujuan</option>{replacements.map(category=><option key={category.id} value={category.id}>{category.name}</option>)}</select><small>Histori laporan akan memakai label kategori pengganti.</small></label>}
      <div className="delete-confirmation-note"><AlertTriangle size={17}/><span>{needsReplacement?'Nominal transaksi, jurnal, dan saldo rekening tidak berubah. Hanya pengelompokan kategori yang dipindahkan.':(deleteCategoryTarget.historyCount||0)>0?'Label dihapus dari pengaturan. Catatan pembatalan tetap tersedia untuk audit dan tidak memengaruhi saldo.':'Penghapusan label tidak dapat dibatalkan setelah disimpan.'}</span></div>
      <div className="modal-actions delete-confirmation-actions"><Button variant="secondary" onClick={()=>setDeleteCategoryTarget(null)} disabled={saving}>Batal</Button><Button variant="danger" onClick={()=>void deleteExpenseCategory()} disabled={saving||(needsReplacement&&!replacementCategoryId)}><Trash2 size={15}/>{saving?'Memproses…':needsReplacement?'Gabungkan & hapus':'Hapus kategori'}</Button></div>
    </Modal>})()}
  </>
}

function SettingHeading({title,description,locked=false}:{title:string;description:string;locked?:boolean}){return <div className="settings-heading"><div><h2>{title}</h2><p>{description}</p></div>{locked?<Badge tone="neutral"><LockKeyhole size={12}/> Hanya Owner/Admin</Badge>:<Badge tone="success"><CheckCircle2 size={12}/> Aktif</Badge>}</div>}
function SaveActions({saving,label='Simpan perubahan',icon=<Save size={15}/>}: {saving:boolean;label?:string;icon?:ReactNode}){return <div className="modal-actions span-2"><Button type="submit" disabled={saving}>{icon}{saving?'Menyimpan…':label}</Button></div>}
function SettingToggle({name,title,description,defaultChecked,disabled}:{name:string;title:string;description:string;defaultChecked:boolean;disabled:boolean}){return <label className="settings-toggle"><span><strong>{title}</strong><small>{description}</small></span><input name={name} type="checkbox" defaultChecked={defaultChecked} disabled={disabled}/><i/></label>}
