import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, KeyRound, MoreHorizontal, Plus, ShieldCheck, UserCog, UserRoundCheck, UserRoundX, Users } from 'lucide-react'
import { Badge, Button, Card, Modal, PageHeader } from '../components/ui'
import { useFinance } from '../lib/FinanceContext'
import type { UserRole, WorkspaceUser } from '../types'

const roleLabel:Record<UserRole,string>={owner:'Owner',admin:'Admin',finance:'Finance',staff:'Staff'}
const roleDescription:Record<UserRole,string>={owner:'Akses penuh dan pengendali workspace',admin:'Kelola tim serta operasional perusahaan',finance:'Kelola anggaran dan posting transaksi',staff:'Buat pengajuan dan transaksi pending'}

function formatActivity(value?:string){if(!value)return 'Belum pernah masuk';return new Intl.DateTimeFormat('id-ID',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value))}

export function TeamManagement(){
  const {user:currentUser}=useFinance()
  const [users,setUsers]=useState<WorkspaceUser[]>([])
  const [loading,setLoading]=useState(true)
  const [saving,setSaving]=useState(false)
  const [error,setError]=useState('')
  const [createModal,setCreateModal]=useState(false)
  const [editing,setEditing]=useState<WorkspaceUser|null>(null)
  const [resetting,setResetting]=useState<WorkspaceUser|null>(null)
  const isOwner=currentUser?.role==='owner'

  const loadUsers=useCallback(async()=>{setLoading(true);setError('');try{const response=await fetch('/api/users',{credentials:'include'});const body=await response.json().catch(()=>({})) as {users?:WorkspaceUser[];error?:string};if(!response.ok)throw new Error(body.error||'Data pengguna belum dapat dimuat');setUsers(body.users||[])}catch(e){setError(e instanceof Error?e.message:'Terjadi kesalahan')}finally{setLoading(false)}},[])
  useEffect(()=>{void loadUsers()},[loadUsers])
  const summary=useMemo(()=>({active:users.filter(item=>item.active).length,admins:users.filter(item=>item.role==='owner'||item.role==='admin').length,finance:users.filter(item=>item.role==='finance').length,staff:users.filter(item=>item.role==='staff').length}),[users])
  function canManage(target:WorkspaceUser){if(target.role==='owner')return false;if(currentUser?.role==='admin'&&target.role==='admin')return false;return currentUser?.role==='owner'||currentUser?.role==='admin'}
  async function request(url:string,options:RequestInit){setSaving(true);setError('');try{const response=await fetch(url,{...options,credentials:'include',headers:{'Content-Type':'application/json',...(options.headers||{})}});const body=await response.json().catch(()=>({})) as {error?:string};if(!response.ok)throw new Error(body.error||'Perubahan belum dapat disimpan');await loadUsers();return true}catch(e){setError(e instanceof Error?e.message:'Terjadi kesalahan');return false}finally{setSaving(false)}}
  async function createUser(formData:FormData){const password=String(formData.get('password')),confirmation=String(formData.get('confirmation'));if(password!==confirmation){setError('Konfirmasi kata sandi tidak sama');return}const ok=await request('/api/users',{method:'POST',body:JSON.stringify({fullName:String(formData.get('fullName')).trim(),email:String(formData.get('email')).trim(),password,role:String(formData.get('role'))})});if(ok)setCreateModal(false)}
  async function updateUser(formData:FormData){if(!editing)return;const ok=await request(`/api/users/${editing.id}`,{method:'PATCH',body:JSON.stringify({role:String(formData.get('role')),active:String(formData.get('active'))==='true'})});if(ok)setEditing(null)}
  async function resetPassword(formData:FormData){if(!resetting)return;const password=String(formData.get('password')),confirmation=String(formData.get('confirmation'));if(password!==confirmation){setError('Konfirmasi kata sandi tidak sama');return}const ok=await request(`/api/users/${resetting.id}/reset-password`,{method:'POST',body:JSON.stringify({password})});if(ok)setResetting(null)}

  return <>
    <PageHeader eyebrow="ADMINISTRASI" title="Tim & akses" description="Kelola akun staff, admin, dan batas kewenangan dalam workspace perusahaan." action={<Button onClick={()=>{setError('');setCreateModal(true)}}><Plus size={16}/> Tambah pengguna</Button>}/>
    {error&&!createModal&&!editing&&!resetting&&<div className="budget-alert error"><span>{error}</span><button onClick={()=>setError('')}>Tutup</button></div>}
    <div className="mini-stats four team-stats"><Card><span>Pengguna aktif</span><strong>{summary.active}</strong><small>dari {users.length} akun</small></Card><Card><span>Owner & Admin</span><strong>{summary.admins}</strong><small>Pengelola akses</small></Card><Card><span>Finance</span><strong>{summary.finance}</strong><small>Posting & anggaran</small></Card><Card><span>Staff</span><strong>{summary.staff}</strong><small>Operasional harian</small></Card></div>

    <div className="team-layout">
      <Card className="data-card team-list-card">
        <div className="card-heading"><div><h2>Daftar pengguna</h2><p>Akun nonaktif langsung kehilangan seluruh sesi login.</p></div><Badge tone="success"><ShieldCheck size={12}/> Akses terkontrol</Badge></div>
        {loading?<div className="team-loading">Memuat pengguna…</div>:<div className="team-user-list">{users.map(item=><article className="team-user-row" key={item.id}>
          <span className={`team-avatar role-${item.role}`}>{item.fullName.split(' ').map(part=>part[0]).join('').slice(0,2).toUpperCase()}</span>
          <div className="team-identity"><strong>{item.fullName}{item.role==='owner'&&<ShieldCheck size={14}/>}</strong><span>{item.email}</span></div>
          <div className="team-role"><Badge tone={item.role==='owner'||item.role==='admin'?'info':item.role==='finance'?'success':'neutral'}>{roleLabel[item.role]}</Badge><small>{roleDescription[item.role]}</small></div>
          <div className="team-activity"><strong>{item.active?'Aktif':'Nonaktif'}</strong><span>{formatActivity(item.lastActiveAt)}</span></div>
          <div className="team-actions">{canManage(item)?<><button onClick={()=>{setError('');setResetting(item)}} title="Reset kata sandi"><KeyRound size={16}/></button><button onClick={()=>{setError('');setEditing(item)}} title="Kelola akses"><MoreHorizontal size={18}/></button></>:<span className="team-locked"><ShieldCheck size={15}/> Terlindungi</span>}</div>
        </article>)}</div>}
      </Card>

      <Card className="permission-card"><div className="card-heading"><div><h2>Matriks akses</h2><p>Ringkasan kewenangan setiap peran.</p></div></div><div className="permission-list">
        <div><span className="permission-icon owner"><ShieldCheck size={18}/></span><p><strong>Owner</strong><small>Semua fitur, pengguna, dan keamanan workspace.</small></p><CheckCircle2 size={17}/></div>
        <div><span className="permission-icon admin"><UserCog size={18}/></span><p><strong>Admin</strong><small>Kelola Staff/Finance, transaksi, dan operasional.</small></p><CheckCircle2 size={17}/></div>
        <div><span className="permission-icon finance"><UserRoundCheck size={18}/></span><p><strong>Finance</strong><small>Posting transaksi, persetujuan, dan RAB.</small></p><CheckCircle2 size={17}/></div>
        <div><span className="permission-icon staff"><Users size={18}/></span><p><strong>Staff</strong><small>Pengajuan belanja dan transaksi Pending.</small></p><CheckCircle2 size={17}/></div>
      </div></Card>
    </div>

    {createModal&&<Modal title="Tambah pengguna" description="Buat akun baru dengan akses sesuai tanggung jawabnya." onClose={()=>{setCreateModal(false);setError('')}}><form className="form-grid" action={createUser}>
      {error&&<div className="auth-error span-2">{error}</div>}
      <label className="span-2">Nama lengkap<input name="fullName" required minLength={2} maxLength={100} autoComplete="off" placeholder="Nama staff"/></label>
      <label className="span-2">Email perusahaan<input name="email" type="email" required maxLength={254} autoComplete="off" placeholder="staff@perusahaan.com"/></label>
      <label>Peran<select name="role" defaultValue="staff">{isOwner&&<option value="admin">Admin</option>}<option value="finance">Finance</option><option value="staff">Staff</option></select></label>
      <label>Status<input value="Aktif setelah dibuat" readOnly/></label>
      <label>Kata sandi awal<input name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" placeholder="Minimal 12 karakter"/></label>
      <label>Konfirmasi kata sandi<input name="confirmation" type="password" required minLength={12} maxLength={128} autoComplete="new-password"/></label>
      <div className="form-note span-2">Kirim kata sandi melalui saluran yang aman. Kata sandi tidak pernah ditampilkan kembali atau disimpan dalam bentuk asli.</div>
      <div className="modal-actions span-2"><Button variant="secondary" onClick={()=>{setCreateModal(false);setError('')}}>Batal</Button><Button type="submit" disabled={saving}>{saving?'Membuat…':'Buat akun'}</Button></div>
    </form></Modal>}

    {editing&&<Modal title="Kelola akses pengguna" description={editing.fullName} onClose={()=>{setEditing(null);setError('')}}><form className="form-grid" action={updateUser}>
      {error&&<div className="auth-error span-2">{error}</div>}
      <div className="user-access-summary span-2"><span className={`team-avatar role-${editing.role}`}>{editing.fullName.slice(0,2).toUpperCase()}</span><div><strong>{editing.fullName}</strong><span>{editing.email}</span></div></div>
      <label>Peran<select name="role" defaultValue={editing.role}>{isOwner&&<option value="admin">Admin</option>}<option value="finance">Finance</option><option value="staff">Staff</option></select></label>
      <label>Status<select name="active" defaultValue={String(editing.active)}><option value="true">Aktif</option><option value="false">Nonaktif</option></select></label>
      <div className="form-note span-2">Menonaktifkan akun akan mencabut semua sesi login pengguna tersebut secara langsung.</div>
      <div className="modal-actions span-2"><Button variant="secondary" onClick={()=>{setEditing(null);setError('')}}>Batal</Button><Button type="submit" disabled={saving}>Simpan akses</Button></div>
    </form></Modal>}

    {resetting&&<Modal title="Reset kata sandi" description={`Semua sesi ${resetting.fullName} akan dikeluarkan.`} onClose={()=>{setResetting(null);setError('')}}><form className="form-grid" action={resetPassword}>
      {error&&<div className="auth-error span-2">{error}</div>}
      <label className="span-2">Kata sandi baru<input name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" placeholder="Minimal 12 karakter"/></label>
      <label className="span-2">Konfirmasi kata sandi<input name="confirmation" type="password" required minLength={12} maxLength={128} autoComplete="new-password"/></label>
      <div className="team-danger-note span-2"><UserRoundX size={18}/><span>Reset akan menghapus seluruh sesi aktif pengguna dan mewajibkan login ulang.</span></div>
      <div className="modal-actions span-2"><Button variant="secondary" onClick={()=>{setResetting(null);setError('')}}>Batal</Button><Button type="submit" disabled={saving}>Reset kata sandi</Button></div>
    </form></Modal>}
  </>
}
