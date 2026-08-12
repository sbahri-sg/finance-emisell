import { useState, type FormEvent } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Bell, Building2, CalendarClock, ChevronDown, CircleDollarSign,
  FileBarChart, Gauge, Landmark, Menu, PiggyBank, Plus, ReceiptText, Search, Settings, ShoppingCart,
  ShieldCheck, Users, WalletCards, X,
} from 'lucide-react'
import { Button } from './ui'
import { useFinance } from '../lib/FinanceContext'

const navGroups = [
  {label:'Ringkasan',items:[{to:'/',label:'Dashboard',icon:Gauge}]},
  {label:'Keuangan',items:[{to:'/transaksi',label:'Transaksi',icon:ReceiptText},{to:'/rekening',label:'Rekening & saldo',icon:Landmark},{to:'/deposit',label:'Deposit',icon:CircleDollarSign}]},
  {label:'Operasional',items:[{to:'/pengajuan-belanja',label:'Pengajuan Belanja',icon:ShoppingCart},{to:'/tagihan',label:'Tagihan & Renewal',icon:CalendarClock}]},
  {label:'Perencanaan',items:[{to:'/anggaran',label:'Anggaran Bulanan',icon:PiggyBank},{to:'/laporan',label:'Laporan',icon:FileBarChart}]},
  {label:'Administrasi',managerOnly:true,items:[{to:'/tim',label:'Tim & Akses',icon:Users}]},
]

const titles: Record<string, string> = {
  '/': 'Ringkasan keuangan',
  '/rekening': 'Rekening & saldo',
  '/transaksi': 'Semua transaksi',
  '/pengajuan-belanja': 'Pengajuan belanja',
  '/anggaran': 'Anggaran bulanan (RAB)',
  '/tagihan': 'Tagihan & renewal',
  '/deposit': 'Deposit platform',
  '/laporan': 'Laporan',
  '/tim': 'Tim & akses',
  '/pengaturan': 'Pengaturan',
}

export function Layout() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [search,setSearch]=useState('')
  const location = useLocation()
  const navigate=useNavigate()
  const { user,organization,settings,bills,purchaseRequests,accounts,deposits } = useFinance()
  const canManage=user?.role==='owner'||user?.role==='admin'||user?.role==='finance'
  const cashBalance=accounts.filter(account=>['bank','cash','ewallet'].includes(account.kind)).reduce((sum,account)=>sum+account.balance,0)
  const attention=(settings.notifyBills?bills.filter(bill=>bill.status==='due'||bill.status==='overdue').length:0)+(canManage?(settings.notifyPurchaseApproval?purchaseRequests.filter(request=>request.status==='submitted'||request.status==='approved').length:0)+(settings.notifyReconciliation?accounts.filter(account=>['bank','cash','ewallet'].includes(account.kind)&&!account.reconciled).length:0)+(settings.notifyLowDeposit?deposits.filter(deposit=>deposit.balance<deposit.lowBalanceThreshold).length:0)+(settings.minimumCashBalance>0&&cashBalance<settings.minimumCashBalance?1:0):purchaseRequests.filter(request=>request.requestedById===user?.userId&&!['received','rejected'].includes(request.status)).length)
  function submitSearch(event:FormEvent){event.preventDefault();const value=search.trim();if(value)navigate(`/transaksi?search=${encodeURIComponent(value)}`)}

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
        <div className="brand">
          <div className="brand-mark"><WalletCards size={22} /></div>
          <div><strong>Emisell Finance</strong><span>Finance workspace</span></div>
          <button className="mobile-close" onClick={() => setMobileOpen(false)} aria-label="Tutup menu"><X size={20} /></button>
        </div>

        <button className="company-switcher">
          <span className="company-avatar"><Building2 size={17} /></span>
          <span><strong>{organization.name}</strong><small>Workspace utama</small></span>
          <ChevronDown size={15} />
        </button>

        <nav className="main-nav" aria-label="Navigasi utama">
          {navGroups.filter(group=>!group.managerOnly||user?.role==='owner'||user?.role==='admin').map(group=><div className="nav-group" key={group.label}><div className="nav-label">{group.label}</div>{group.items.map(item=><NavLink key={item.to} to={item.to} end={item.to==='/' } onClick={()=>setMobileOpen(false)}><item.icon size={18}/><span>{item.label}</span>{item.to==='/tagihan'&&bills.filter(bill=>bill.status==='due'||bill.status==='overdue').length>0&&<em>{bills.filter(bill=>bill.status==='due'||bill.status==='overdue').length}</em>}</NavLink>)}</div>)}
        </nav>

        <div className="sidebar-footer">
          <NavLink to="/pengaturan"><Settings size={18} /><span>Pengaturan</span></NavLink>
          <div className="secure-note"><ShieldCheck size={17} /><span><strong>Data terlindungi</strong><small>Audit log aktif</small></span></div>
          <div className="user-card">
            <span className="user-avatar">{user?.fullName.split(' ').map(part=>part[0]).slice(0,2).join('').toUpperCase()||'EF'}</span>
            <span><strong>{user?.fullName||'Pengguna'}</strong><small>{user?.role||'—'}</small></span>
            <ChevronDown size={15} />
          </div>
        </div>
      </aside>
      {mobileOpen && <div className="sidebar-scrim" onClick={() => setMobileOpen(false)} />}

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-title">
            <button className="menu-button" onClick={() => setMobileOpen(true)} aria-label="Buka menu"><Menu size={21} /></button>
            <span>{titles[location.pathname] ?? 'Emisell Finance'}</span>
          </div>
          <div className="topbar-actions">
            <form className="global-search" onSubmit={submitSearch}><input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Cari transaksi, vendor…" aria-label="Cari transaksi"/><button type="submit" aria-label="Mulai pencarian"><Search size={17}/></button></form>
            <button className="notification-button" aria-label={`${attention} hal perlu tindakan`} onClick={()=>navigate('/#perlu-tindakan')}><Bell size={19}/>{attention>0&&<span/>}</button>
            <Button onClick={()=>navigate(canManage?'/transaksi?buat=expense':'/pengajuan-belanja?buat=1')}><Plus size={17}/>{canManage?'Transaksi':'Pengajuan'}</Button>
          </div>
        </header>
        <div className="page-content"><Outlet /></div>
      </main>
    </div>
  )
}
