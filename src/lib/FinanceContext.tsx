import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Account, Bill, DepositAccount, DepositActivity, PurchaseRequest, Transaction } from '../types'

type WorkspaceSettings = {
  defaultAccountId: string
  minimumCashBalance: number
  notifyBills: boolean
  notifyLowDeposit: boolean
  notifyPurchaseApproval: boolean
  notifyReconciliation: boolean
}
type FinanceData = {
  organization: { name: string }
  settings: WorkspaceSettings
  user: { userId: string; role: 'owner' | 'admin' | 'finance' | 'staff'; fullName: string } | null
  accounts: Account[]
  transactions: Transaction[]
  depositActivities: DepositActivity[]
  bills: Bill[]
  deposits: DepositAccount[]
  purchaseRequests: PurchaseRequest[]
  refresh: () => Promise<void>
}
const defaultSettings: WorkspaceSettings = {
  defaultAccountId: '',
  minimumCashBalance: 0,
  notifyBills: true,
  notifyLowDeposit: true,
  notifyPurchaseApproval: true,
  notifyReconciliation: true,
}
const empty: FinanceData = {
  organization: { name: 'Emisell' },
  settings: defaultSettings,
  user: null,
  accounts: [],
  transactions: [],
  depositActivities: [],
  bills: [],
  deposits: [],
  purchaseRequests: [],
  refresh: async () => {},
}
const Context = createContext<FinanceData>(empty)
export function FinanceProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState(empty)
  const refresh = useCallback(async () => {
    const response = await fetch('/api/bootstrap', { credentials: 'include' })
    if (!response.ok) return
    const raw = await response.json()
    const accounts = (raw.accounts || []).map((a: Record<string, unknown>) => ({
      ...a,
      balance: Number(a.balance),
      availableBalance: Number(a.balance),
      reconciled: Boolean(a.reconciled),
      reconciliationDifference: Number(a.reconciliationDifference || 0),
      monthlyUsage: Number(a.monthlyUsage || 0),
      dailyAverage: Number(a.dailyAverage || 0),
    })) as Account[]
    setData({
      ...empty,
      organization: raw.organization || empty.organization,
      settings: { ...defaultSettings, ...raw.settings, minimumCashBalance: Number(raw.settings?.minimumCashBalance || 0) },
      user: raw.user || null,
      accounts,
      transactions: (raw.transactions || []).map((t: Record<string, unknown>) => ({ ...t, amount: Number(t.amount) })),
      depositActivities: (raw.depositActivities || []).map((activity: Record<string, unknown>) => ({ ...activity, amount: Number(activity.amount), reversed: Boolean(activity.reversed) })),
      bills: (raw.bills || []).map((b: Record<string, unknown>) => ({
        ...b,
        amount: Number(b.amount),
        unitPrice: Number(b.unitPrice || b.amount),
        quantity: Number(b.quantity || 1),
        recurrence: b.recurrence === 'monthly' ? 'Bulanan' : b.recurrence === 'yearly' ? 'Tahunan' : 'Sekali',
      })),
      purchaseRequests: (raw.purchaseRequests || []).map((p: Record<string, unknown>) => ({
        ...p,
        amount: Number(p.amount),
        paidAmount: p.paidAmount ? Number(p.paidAmount) : undefined,
      })),
      deposits: accounts
        .filter((a) => a.kind === 'deposit')
        .map((a) => ({
          id: a.id,
          platform: a.name,
          accountName: a.institution,
          maskedNumber: a.maskedNumber,
          balance: a.balance,
          monthlyUsage: a.monthlyUsage || 0,
          dailyAverage: a.dailyAverage || 0,
          lowBalanceThreshold: a.lowBalanceThreshold || 0,
          color: a.color,
          reconciled: a.reconciled,
          lastReconciledAt: a.lastReconciledAt,
          reconciliationDifference: a.reconciliationDifference || 0,
        })),
      refresh,
    })
  }, [])
  useEffect(() => {
    void refresh()
  }, [refresh])
  return <Context.Provider value={data}>{children}</Context.Provider>
}
// eslint-disable-next-line react-refresh/only-export-components
export function useFinance() {
  return useContext(Context)
}
