import type { Account, Bill, CashflowPoint, DepositAccount, PurchaseRequest, Transaction } from '../types'

export const accounts: Account[] = [
  { id: 'acc-bca', name: 'BCA Operasional', institution: 'Bank Central Asia', kind: 'bank', maskedNumber: '•••• 4821', balance: 78450000, availableBalance: 76950000, currency: 'IDR', reconciled: true, color: '#225c55' },
  { id: 'acc-mandiri', name: 'Mandiri Utama', institution: 'Bank Mandiri', kind: 'bank', maskedNumber: '•••• 1934', balance: 46280000, availableBalance: 46280000, currency: 'IDR', reconciled: true, color: '#d89b50' },
  { id: 'acc-cash', name: 'Kas Kecil', institution: 'Kantor', kind: 'cash', maskedNumber: 'Tunai', balance: 2750000, availableBalance: 2750000, currency: 'IDR', reconciled: true, color: '#6b7d78' },
  { id: 'acc-card', name: 'BCA Corporate Card', institution: 'Bank Central Asia', kind: 'credit', maskedNumber: '•••• 7702', balance: -7350000, availableBalance: 12650000, creditLimit: 20000000, currency: 'IDR', reconciled: false, color: '#483f64' },
]

export const transactions: Transaction[] = [
  { id: 'TRX-0824', date: '2026-08-10', description: 'Deposit Meta Ads', category: 'Transfer deposit', account: 'BCA Operasional', kind: 'deposit', amount: -10000000, status: 'posted', reference: 'META-100826', attachment: true },
  { id: 'TRX-0823', date: '2026-08-09', description: 'Pembayaran AWS', category: 'Server & cloud', account: 'BCA Corporate Card', kind: 'expense', amount: -3850000, status: 'posted', reference: 'AWS-0726', attachment: true },
  { id: 'TRX-0822', date: '2026-08-08', description: 'Pendapatan proyek Nusa', category: 'Pendapatan', account: 'Mandiri Utama', kind: 'income', amount: 35000000, status: 'posted', reference: 'INV-2026-118', attachment: true },
  { id: 'TRX-0821', date: '2026-08-07', description: 'Pembelian tinta printer', category: 'Kebutuhan kantor', account: 'Kas Kecil', kind: 'expense', amount: -475000, status: 'posted', reference: 'KK-0807', attachment: true },
  { id: 'TRX-0820', date: '2026-08-06', description: 'Canva Teams', category: 'Software', account: 'BCA Corporate Card', kind: 'expense', amount: -1450000, status: 'pending', reference: 'CANVA-0806' },
  { id: 'TRX-0819', date: '2026-08-05', description: 'Transfer BCA ke Mandiri', category: 'Transfer internal', account: 'BCA Operasional', kind: 'transfer', amount: -15000000, status: 'posted', reference: 'TRF-0805', attachment: true },
]

export const bills: Bill[] = [
  { id: 'bill-aws', vendor: 'Amazon Web Services', description: 'Cloud infrastructure', dueDate: '2026-08-13', amount: 3850000, currency: 'IDR', recurrence: 'Bulanan', status: 'due', owner: 'Raka', autoRenew: true },
  { id: 'bill-domain', vendor: 'Cloudflare', description: 'Domain perusahaan', dueDate: '2026-08-17', amount: 420000, currency: 'IDR', recurrence: 'Tahunan', status: 'upcoming', owner: 'Dimas', autoRenew: false },
  { id: 'bill-canva', vendor: 'Canva', description: 'Canva Teams · 5 seats', dueDate: '2026-08-22', amount: 1450000, currency: 'IDR', recurrence: 'Bulanan', status: 'upcoming', owner: 'Nadia', autoRenew: true },
  { id: 'bill-gworkspace', vendor: 'Google Workspace', description: 'Business Standard · 8 users', dueDate: '2026-08-28', amount: 1320000, currency: 'IDR', recurrence: 'Bulanan', status: 'upcoming', owner: 'Dimas', autoRenew: true },
]

export const deposits: DepositAccount[] = [
  { id: 'dep-meta', platform: 'Meta Ads', accountName: 'Main Business Account', balance: 18450000, monthlyUsage: 31750000, dailyAverage: 1058000, lowBalanceThreshold: 7000000, color: '#3976d8' },
  { id: 'dep-google', platform: 'Google Ads', accountName: 'Search Campaign', balance: 9820000, monthlyUsage: 12680000, dailyAverage: 423000, lowBalanceThreshold: 4000000, color: '#d69b35' },
  { id: 'dep-tiktok', platform: 'TikTok Ads', accountName: 'Awareness Account', balance: 3450000, monthlyUsage: 8550000, dailyAverage: 285000, lowBalanceThreshold: 4000000, color: '#1d2927' },
]

export const cashflow: CashflowPoint[] = [
  { month: 'Mar', income: 71000000, expense: 46000000 },
  { month: 'Apr', income: 85000000, expense: 52000000 },
  { month: 'Mei', income: 78000000, expense: 48000000 },
  { month: 'Jun', income: 99000000, expense: 61000000 },
  { month: 'Jul', income: 92000000, expense: 57000000 },
  { month: 'Agu', income: 107000000, expense: 64750000 },
]

export const purchaseRequests: PurchaseRequest[] = [
  { id: 'pr-001', requestNumber: 'PR-2026-0081', requestedAt: '2026-08-10', requestedBy: 'Nadia', department: 'Marketing', title: 'Perlengkapan meja kerja', purpose: 'Penambahan perlengkapan untuk dua staff baru', itemCount: 4, amount: 2850000, urgency: 'Normal', status: 'submitted', vendor: 'Tokopedia' },
  { id: 'pr-002', requestNumber: 'PR-2026-0080', requestedAt: '2026-08-09', requestedBy: 'Dimas', department: 'IT', title: 'UPS untuk server kantor', purpose: 'Menjaga server tetap aktif saat listrik padam', itemCount: 1, amount: 4250000, urgency: 'Mendesak', status: 'approved', vendor: 'Enter Komputer' },
  { id: 'pr-003', requestNumber: 'PR-2026-0079', requestedAt: '2026-08-07', requestedBy: 'Raka', department: 'Operasional', title: 'Stok ATK bulanan', purpose: 'Pengadaan rutin alat tulis kantor', itemCount: 8, amount: 1375000, urgency: 'Normal', status: 'purchased', vendor: 'OfficeMart' },
  { id: 'pr-004', requestNumber: 'PR-2026-0078', requestedAt: '2026-08-05', requestedBy: 'Nadia', department: 'Marketing', title: 'Kursi kerja ergonomis', purpose: 'Penggantian kursi yang rusak', itemCount: 1, amount: 2100000, urgency: 'Normal', status: 'received', vendor: 'IKEA' },
  { id: 'pr-005', requestNumber: 'PR-2026-0077', requestedAt: '2026-08-04', requestedBy: 'Dimas', department: 'IT', title: 'Adaptor laptop cadangan', purpose: 'Cadangan untuk perangkat operasional', itemCount: 2, amount: 950000, urgency: 'Normal', status: 'rejected' },
]
