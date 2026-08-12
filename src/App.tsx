import { lazy, Suspense } from 'react'
import { Navigate, RouterProvider, createBrowserRouter } from 'react-router-dom'
import { AuthGate } from './components/AuthGate'
import { FinanceProvider } from './lib/FinanceContext'
import { Layout } from './components/Layout'

const Dashboard = lazy(() => import('./pages/Dashboard').then((module) => ({ default: module.Dashboard })))
const Accounts = lazy(() => import('./pages/Accounts').then((module) => ({ default: module.Accounts })))
const Transactions = lazy(() => import('./pages/Transactions').then((module) => ({ default: module.Transactions })))
const PurchaseRequests = lazy(() => import('./pages/PurchaseRequests').then((module) => ({ default: module.PurchaseRequests })))
const MonthlyBudget = lazy(() => import('./pages/MonthlyBudget').then((module) => ({ default: module.MonthlyBudget })))
const Bills = lazy(() => import('./pages/Bills').then((module) => ({ default: module.Bills })))
const Deposits = lazy(() => import('./pages/Deposits').then((module) => ({ default: module.Deposits })))
const Reports = lazy(() => import('./pages/Reports').then((module) => ({ default: module.Reports })))
const Settings = lazy(() => import('./pages/Settings').then((module) => ({ default: module.Settings })))
const TeamManagement = lazy(() => import('./pages/TeamManagement').then((module) => ({ default: module.TeamManagement })))

const page = (element: React.ReactNode) => <Suspense fallback={<div className="page-loader">Memuat halaman…</div>}>{element}</Suspense>

const router = createBrowserRouter([{
  path: '/',
  element: <Layout />,
  children: [
    { index: true, element: page(<Dashboard />) },
    { path: 'rekening', element: page(<Accounts />) },
    { path: 'transaksi', element: page(<Transactions />) },
    { path: 'pengajuan-belanja', element: page(<PurchaseRequests />) },
    { path: 'anggaran', element: page(<MonthlyBudget />) },
    { path: 'tagihan', element: page(<Bills />) },
    { path: 'deposit', element: page(<Deposits />) },
    { path: 'laporan', element: page(<Reports />) },
    { path: 'tim', element: page(<TeamManagement />) },
    { path: 'pengaturan', element: page(<Settings />) },
    { path: '*', element: <Navigate to="/" replace /> },
  ],
}])

export default function App() {
  return <AuthGate><FinanceProvider><RouterProvider router={router} /></FinanceProvider></AuthGate>
}
