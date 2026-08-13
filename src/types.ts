export type AccountKind = 'bank' | 'cash' | 'credit' | 'ewallet' | 'deposit' | 'clearing'
export type UserRole = 'owner' | 'admin' | 'finance' | 'staff'
export type TransactionStatus = 'posted' | 'pending' | 'draft' | 'reversed'
export type TransactionKind = 'income' | 'expense' | 'transfer' | 'deposit' | 'deposit_topup' | 'deposit_usage' | 'credit_payment' | 'adjustment' | 'reversal'

export interface Account {
  id: string
  name: string
  institution: string
  kind: AccountKind
  maskedNumber: string
  balance: number
  availableBalance: number
  currency: 'IDR' | 'USD'
  reconciled: boolean
  color: string
  creditLimit?: number
  lowBalanceThreshold?: number
  lastReconciledAt?: string
  reconciliationDifference?: number
  monthlyUsage?: number
  dailyAverage?: number
}

export interface Transaction {
  id: string
  date: string
  description: string
  category: string
  account: string
  accountId?: string
  budgetCategoryId?: string
  budgetItemName?: string
  budgetItems?: TransactionBudgetItem[]
  kind: TransactionKind
  amount: number
  status: TransactionStatus
  reference: string
  attachment?: boolean
  counterparty?: string
  invoiceNumber?: string
  incomeSource?: string
  paymentMethod?: 'transfer' | 'ewallet' | 'cash'
  proofUrl?: string
  editable?: boolean
}

export interface Bill {
  id: string
  vendor: string
  description: string
  dueDate: string
  amount: number
  currency: 'IDR' | 'USD'
  recurrence: 'Bulanan' | 'Tahunan' | 'Sekali'
  status: 'upcoming' | 'due' | 'paid' | 'overdue'
  owner: string
  autoRenew: boolean
  reminderDays?: number[]
  paidTransactionId?: string
  unitPrice?: number
  quantity?: number
  paymentMethod?: 'transfer' | 'ewallet' | 'cash'
}

export interface DepositAccount {
  id: string
  platform: string
  accountName: string
  balance: number
  monthlyUsage: number
  dailyAverage: number
  lowBalanceThreshold: number
  color: string
}

export interface CashflowPoint {
  month: string
  income: number
  expense: number
}

export type PurchaseRequestStatus = 'draft' | 'submitted' | 'approved' | 'purchased' | 'received' | 'rejected'

export interface PurchaseRequest {
  id: string
  requestNumber: string
  requestedAt: string
  requestedBy: string
  requestedById?: string
  department: string
  title: string
  purpose: string
  itemCount: number
  amount: number
  urgency: 'Normal' | 'Mendesak'
  status: PurchaseRequestStatus
  vendor?: string
  budgetCategoryId?: string
  budgetCategory?: string
  paymentTransactionId?: string
  paidAmount?: number
  paidAt?: string
  paymentReference?: string
  proofReference?: string
}

export type BudgetCategoryType = 'fixed' | 'variable' | 'emergency' | 'investment'
export type BudgetModel = 'fixed' | 'multi_item'

export interface BudgetLineItem {
  id?: string
  name: string
  quantity: number
  unitPrice: number
  purchasedQuantity?: number
  remainingQuantity?: number
}

export interface TransactionBudgetItem {
  budgetItemId: string
  itemName: string
  quantity: number
  plannedUnitPrice: number
  actualUnitPrice: number
  subtotal: number
}

export interface BudgetPeriod {
  id: string
  month: string
  status: 'draft' | 'active' | 'closed'
  notes: string
}

export interface BudgetCategory {
  id: string
  name: string
  categoryType: BudgetCategoryType
  plannedAmount: number
  actual: number
  pendingAmount: number
  committedAmount: number
  color: string
  expenseCategory?: string
  expenseCategoryId?: string
  details?: string[]
  budgetModel: BudgetModel
  lineItems: BudgetLineItem[]
}

export interface ExpenseCategoryLabel {
  id: string
  name: string
  color: string
  active: boolean
  transactionCount?: number
  budgetCount?: number
}

export interface WorkspaceUser {
  id: string
  fullName: string
  email: string
  role: UserRole
  active: boolean
  createdAt: string
  lastActiveAt?: string
}
