import express, { type NextFunction, type Request, type Response } from 'express'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import { rateLimit } from 'express-rate-limit'
import { z } from 'zod'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { pool, migrate } from './db.js'
import { hashPassword, newSessionToken, tokenHash, verifyPassword } from './security.js'

type Auth = {
  userId: string
  organizationId: string
  role: 'owner' | 'admin' | 'finance' | 'staff'
  fullName: string
  email: string
}
type AuthedRequest = Request & { auth?: Auth }
const app = express(),
  port = Number(process.env.PORT || 3000),
  cookieName = 'emisell_session'
const allowedOrigin = process.env.APP_ORIGIN || 'http://localhost:8080'
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1)
app.disable('x-powered-by')
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
      },
    },
  }),
)
app.use(express.json({ limit: '1mb' }))
app.use(cookieParser())
app.use((req, res, next) => {
  const requestId = req.get('x-request-id') || randomUUID()
  res.setHeader('X-Request-Id', requestId)
  res.locals.requestId = requestId
  next()
})
app.use((req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const origin = req.get('origin'),
      developmentOrigins = process.env.NODE_ENV === 'production' ? [] : ['http://127.0.0.1:5173', 'http://localhost:5173']
    if (origin && origin !== allowedOrigin && !developmentOrigins.includes(origin)) return res.status(403).json({ error: 'Untrusted origin' })
  }
  next()
})

async function optionalAuth(req: AuthedRequest, _res: Response, next: NextFunction) {
  try {
    const token = req.cookies[cookieName]
    if (token) {
      const q = await pool.query(`update sessions s set last_seen_at=now() from users u where s.user_id=u.id and s.token_hash=$1 and s.expires_at>now() and u.active returning u.id "userId",u.organization_id "organizationId",u.role,u.full_name "fullName",u.email`, [tokenHash(token)])
      req.auth = q.rows[0]
    }
    next()
  } catch (e) {
    next(e)
  }
}
function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.auth) return res.status(401).json({ error: 'Authentication required' })
  next()
}
function requireFinance(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.auth || !['owner', 'admin', 'finance'].includes(req.auth.role))
    return res.status(403).json({
      error: 'Hanya Owner, Admin, atau Finance yang dapat melakukan tindakan ini',
    })
  next()
}
function requireUserAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.auth || !['owner', 'admin'].includes(req.auth.role)) return res.status(403).json({ error: 'Hanya Owner atau Admin yang dapat mengelola pengguna' })
  next()
}
app.use(optionalAuth)
const authLimit = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
})
const userAdminLimit = rateLimit({
  windowMs: 15 * 60_000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false,
})
const settingsLimit = rateLimit({
  windowMs: 15 * 60_000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
})
const credentials = z.object({
  email: z.string().email().max(254),
  password: z.string().min(12).max(128),
})

app.get('/api/health', async (_req, res) => {
  await pool.query('select 1')
  res.json({ status: 'ok' })
})
app.get('/api/auth/session', async (req: AuthedRequest, res) => {
  const count = await pool.query('select count(*)::int count from users')
  res.json({
    authenticated: !!req.auth,
    setupRequired: count.rows[0].count === 0,
    user: req.auth || null,
  })
})
app.post('/api/auth/setup', authLimit, async (req, res, next) => {
  try {
    const input = z
      .object({
        organizationName: z.string().min(2).max(120),
        fullName: z.string().min(2).max(100),
      })
      .merge(credentials)
      .parse(req.body)
    const client = await pool.connect()
    try {
      await client.query('begin')
      await client.query('select pg_advisory_xact_lock(991827)')
      const count = await client.query('select count(*)::int count from users')
      if (count.rows[0].count > 0) {
        await client.query('rollback')
        return res.status(409).json({ error: 'Setup already completed' })
      }
      const org = await client.query('insert into organizations(name) values($1) returning id,name', [input.organizationName.trim()])
      const password = await hashPassword(input.password)
      const user = await client.query(`insert into users(organization_id,email,full_name,password_hash,role) values($1,$2,$3,$4,'owner') returning id`, [org.rows[0].id, input.email.toLowerCase(), input.fullName.trim(), password])
      await client.query(`insert into accounts(organization_id,name,kind,color) values($1,'Kas Kecil','cash','#6b7d78'),($1,'Pendapatan','clearing','#225c55'),($1,'Pengeluaran','clearing','#d89b50')`, [org.rows[0].id])
      await client.query(`insert into expense_categories(organization_id,name,color) values($1,'Utilities & Langganan','#4f78a5'),($1,'Konsumsi & Pantry','#d89b50'),($1,'Kebersihan & Perlengkapan','#6f9f72'),($1,'Kegiatan','#b98953'),($1,'Personalia','#8a6fa5'),($1,'Lain-Lain','#8b9692')`, [org.rows[0].id])
      await client.query('commit')
      await createSession(res, user.rows[0].id)
      res.status(201).json({ ok: true })
    } catch (e) {
      await client.query('rollback')
      throw e
    } finally {
      client.release()
    }
  } catch (e) {
    next(e)
  }
})
app.post('/api/auth/login', authLimit, async (req, res, next) => {
  try {
    const input = credentials.parse(req.body)
    const q = await pool.query('select id,password_hash from users where lower(email)=lower($1) and active', [input.email])
    if (!q.rowCount || !(await verifyPassword(input.password, q.rows[0].password_hash))) return res.status(401).json({ error: 'Email atau kata sandi tidak sesuai' })
    await createSession(res, q.rows[0].id)
    res.json({ ok: true })
  } catch (e) {
    next(e)
  }
})
async function createSession(res: Response, userId: string) {
  const duration = await pool.query(`select coalesce(s.session_hours,12)::int hours from users u left join organization_settings s on s.organization_id=u.organization_id where u.id=$1`, [userId]),
    hours = Math.min(168, Math.max(1, Number(duration.rows[0]?.hours || 12))),
    token = newSessionToken()
  await pool.query(`insert into sessions(user_id,token_hash,expires_at) values($1,$2,now()+($3::text||' hours')::interval)`, [userId, tokenHash(token), hours])
  res.cookie(cookieName, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: hours * 60 * 60 * 1000,
    path: '/',
  })
}
app.post('/api/auth/logout', requireAuth, async (req: AuthedRequest, res) => {
  await pool.query('delete from sessions where token_hash=$1', [tokenHash(req.cookies[cookieName])])
  res.clearCookie(cookieName, { path: '/' })
  res.status(204).end()
})

const managedRole = z.enum(['admin', 'finance', 'staff'])
function canManageTarget(actor: Auth, target: { id: string; role: string }) {
  if (target.id === actor.userId || target.role === 'owner') return false
  if (actor.role === 'admin' && target.role === 'admin') return false
  return true
}

app.get('/api/users', requireAuth, requireUserAdmin, async (req: AuthedRequest, res, next) => {
  try {
    const users = await pool.query(`select u.id,u.full_name "fullName",u.email,u.role,u.active,u.created_at "createdAt",(select max(s.last_seen_at) from sessions s where s.user_id=u.id) "lastActiveAt" from users u where u.organization_id=$1 order by case u.role when 'owner' then 1 when 'admin' then 2 when 'finance' then 3 else 4 end,u.full_name`, [req.auth!.organizationId])
    res.json({ users: users.rows })
  } catch (e) {
    next(e)
  }
})

app.post('/api/users', userAdminLimit, requireAuth, requireUserAdmin, async (req: AuthedRequest, res, next) => {
  try {
    const input = z
      .object({
        fullName: z.string().trim().min(2).max(100),
        email: z.string().trim().email().max(254),
        password: z.string().min(12).max(128),
        role: managedRole,
      })
      .parse(req.body)
    if (req.auth!.role === 'admin' && input.role === 'admin') return res.status(403).json({ error: 'Admin hanya dapat membuat akun Finance atau Staff' })
    const passwordHash = await hashPassword(input.password)
    const user = await pool.query(`insert into users(organization_id,email,full_name,password_hash,role) values($1,lower($2),$3,$4,$5) returning id`, [req.auth!.organizationId, input.email, input.fullName, passwordHash, input.role])
    await pool.query(`insert into audit_logs(organization_id,actor_id,entity,entity_id,action,data) values($1,$2,'user',$3,'create',$4)`, [
      req.auth!.organizationId,
      req.auth!.userId,
      user.rows[0].id,
      JSON.stringify({
        email: input.email.toLowerCase(),
        fullName: input.fullName,
        role: input.role,
      }),
    ])
    res.status(201).json({ id: user.rows[0].id })
  } catch (e) {
    if ((e as { code?: string }).code === '23505') return res.status(409).json({ error: 'Email sudah digunakan oleh pengguna lain' })
    next(e)
  }
})

app.patch('/api/users/:id', userAdminLimit, requireAuth, requireUserAdmin, async (req: AuthedRequest, res, next) => {
  try {
    const input = z
      .object({
        role: managedRole.optional(),
        active: z.boolean().optional(),
      })
      .refine((value) => value.role !== undefined || value.active !== undefined)
      .parse(req.body)
    const target = await pool.query(`select id,role,active from users where id=$1 and organization_id=$2`, [req.params.id, req.auth!.organizationId])
    if (!target.rowCount) return res.status(404).json({ error: 'Pengguna tidak ditemukan' })
    if (!canManageTarget(req.auth!, target.rows[0])) return res.status(403).json({ error: 'Akun ini tidak dapat diubah oleh Anda' })
    if (req.auth!.role === 'admin' && input.role === 'admin') return res.status(403).json({ error: 'Admin tidak dapat memberikan peran Admin' })
    const updated = await pool.query(`update users set role=coalesce($1,role),active=coalesce($2,active) where id=$3 returning id,role,active`, [input.role ?? null, input.active ?? null, target.rows[0].id])
    if (input.active === false) await pool.query('delete from sessions where user_id=$1', [target.rows[0].id])
    await pool.query(`insert into audit_logs(organization_id,actor_id,entity,entity_id,action,data) values($1,$2,'user',$3,'update_access',$4)`, [
      req.auth!.organizationId,
      req.auth!.userId,
      target.rows[0].id,
      JSON.stringify({
        before: {
          role: target.rows[0].role,
          active: target.rows[0].active,
        },
        after: {
          role: updated.rows[0].role,
          active: updated.rows[0].active,
        },
      }),
    ])
    res.json({ ok: true })
  } catch (e) {
    next(e)
  }
})

app.post('/api/users/:id/reset-password', userAdminLimit, requireAuth, requireUserAdmin, async (req: AuthedRequest, res, next) => {
  try {
    const { password } = z.object({ password: z.string().min(12).max(128) }).parse(req.body)
    const target = await pool.query(`select id,role from users where id=$1 and organization_id=$2`, [req.params.id, req.auth!.organizationId])
    if (!target.rowCount) return res.status(404).json({ error: 'Pengguna tidak ditemukan' })
    if (!canManageTarget(req.auth!, target.rows[0])) return res.status(403).json({ error: 'Kata sandi akun ini tidak dapat direset oleh Anda' })
    const passwordHash = await hashPassword(password)
    const c = await pool.connect()
    try {
      await c.query('begin')
      await c.query('update users set password_hash=$1 where id=$2', [passwordHash, target.rows[0].id])
      await c.query('delete from sessions where user_id=$1', [target.rows[0].id])
      await c.query(`insert into audit_logs(organization_id,actor_id,entity,entity_id,action,data) values($1,$2,'user',$3,'reset_password',$4)`, [req.auth!.organizationId, req.auth!.userId, target.rows[0].id, JSON.stringify({ sessionsRevoked: true })])
      await c.query('commit')
    } catch (e) {
      await c.query('rollback')
      throw e
    } finally {
      c.release()
    }
    res.json({ ok: true })
  } catch (e) {
    next(e)
  }
})

const workspaceProfileInput = z.object({
  name: z.string().trim().min(2).max(120),
  legalName: z.string().trim().max(160),
  taxId: z.string().trim().max(40),
  financeEmail: z.union([z.literal(''), z.string().trim().email().max(254)]),
  address: z.string().trim().max(500),
  timezone: z.enum(['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura']),
  baseCurrency: z.enum(['IDR', 'USD']),
})
const workspacePreferenceInput = z.object({
  defaultAccountId: z.union([z.literal(''), z.string().uuid()]),
  transactionPrefix: z
    .string()
    .trim()
    .min(2)
    .max(12)
    .regex(/^[A-Za-z0-9-]+$/),
  purchasePrefix: z
    .string()
    .trim()
    .min(2)
    .max(12)
    .regex(/^[A-Za-z0-9-]+$/),
  minimumCashBalance: z.number().nonnegative().max(1e15),
})
const notificationInput = z.object({
  billReminderDays: z.number().int().min(1).max(60),
  notifyBills: z.boolean(),
  notifyLowDeposit: z.boolean(),
  notifyPurchaseApproval: z.boolean(),
  notifyReconciliation: z.boolean(),
})
const governanceInput = z.object({
  ownerApprovalThreshold: z.number().nonnegative().max(1e15),
  sessionHours: z.number().int().min(1).max(168),
})
const expenseCategoryLabelInput = z.object({
  name: z.string().trim().min(2).max(80),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  active: z.boolean().optional(),
})
const expenseCategoryMergeInput = z.object({ replacementCategoryId: z.string().uuid().optional() })

async function getExpenseCategory(c: Pick<typeof pool, 'query'> | import('pg').PoolClient, org: string, name: string, allowInactive = false) {
  const category = await c.query(`select id,name,color,active from expense_categories where organization_id=$1 and lower(name)=lower($2)${allowInactive ? '' : ' and active'}`, [org, name])
  if (!category.rowCount) throw Object.assign(new Error('Kategori pengeluaran tidak valid atau tidak aktif'), { statusCode: 400 })
  return category.rows[0] as { id: string; name: string; color: string; active: boolean }
}
async function getFallbackExpenseCategory(c: Pick<typeof pool, 'query'> | import('pg').PoolClient, org: string, preferred: string) {
  const category = await c.query(`select id,name,color,active from expense_categories where organization_id=$1 and active order by case when lower(name)=lower($2) then 0 else 1 end,name limit 1`, [org, preferred])
  if (!category.rowCount) throw Object.assign(new Error('Belum ada kategori pengeluaran aktif'), { statusCode: 409 })
  return category.rows[0] as { id: string; name: string; color: string; active: boolean }
}

app.get('/api/settings', requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const org = req.auth!.organizationId
    await pool.query('insert into organization_settings(organization_id) values($1) on conflict(organization_id) do nothing', [org])
    const [profile, settings, accounts, expenseCategories] = await Promise.all([
      pool.query(`select name,coalesce(legal_name,'') "legalName",coalesce(tax_id,'') "taxId",coalesce(finance_email,'') "financeEmail",coalesce(address,'') address,timezone,base_currency "baseCurrency" from organizations where id=$1`, [org]),
      pool.query(`select coalesce(default_account_id::text,'') "defaultAccountId",transaction_prefix "transactionPrefix",purchase_prefix "purchasePrefix",minimum_cash_balance::numeric "minimumCashBalance",bill_reminder_days "billReminderDays",notify_bills "notifyBills",notify_low_deposit "notifyLowDeposit",notify_purchase_approval "notifyPurchaseApproval",notify_reconciliation "notifyReconciliation",owner_approval_threshold::numeric "ownerApprovalThreshold",session_hours "sessionHours",updated_at "updatedAt" from organization_settings where organization_id=$1`, [org]),
      pool.query(`select id,name,kind from accounts where organization_id=$1 and active and kind in('bank','cash','ewallet') order by name`, [org]),
      pool.query(`select ec.id,ec.name,ec.color,ec.active,
        (select count(*)::int from transactions t where t.expense_category_id=ec.id and t.status<>'reversed' and t.kind<>'reversal' and not exists(select 1 from transactions r where r.reversal_of=t.id and r.status='posted')) "transactionCount",
        (select count(*)::int from transactions t where t.expense_category_id=ec.id and (t.status='reversed' or t.kind='reversal' or exists(select 1 from transactions r where r.reversal_of=t.id and r.status='posted'))) "historyCount",
        (select count(*)::int from budget_categories bc where bc.expense_category_id=ec.id) "budgetCount"
        from expense_categories ec where ec.organization_id=$1 order by ec.active desc,ec.name`, [org]),
    ])
    res.json({
      profile: profile.rows[0],
      settings: settings.rows[0],
      accounts: accounts.rows,
      expenseCategories: expenseCategories.rows,
      canAdmin: ['owner', 'admin'].includes(req.auth!.role),
    })
  } catch (e) {
    next(e)
  }
})

app.get('/api/expense-categories', requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const includeInactive = req.query.includeInactive === 'true' && ['owner', 'admin'].includes(req.auth!.role)
    const categories = await pool.query(`select id,name,color,active from expense_categories where organization_id=$1${includeInactive ? '' : ' and active'} order by active desc,name`, [req.auth!.organizationId])
    res.json({ categories: categories.rows })
  } catch (e) {
    next(e)
  }
})

app.post('/api/expense-categories', settingsLimit, requireAuth, requireUserAdmin, async (req: AuthedRequest, res, next) => {
  try {
    const input = expenseCategoryLabelInput.parse(req.body)
    const category = await pool.query(`insert into expense_categories(organization_id,name,color) values($1,$2,$3) returning id,name,color,active`, [req.auth!.organizationId, input.name, input.color])
    await pool.query(`insert into audit_logs(organization_id,actor_id,entity,entity_id,action,data) values($1,$2,'expense_category',$3,'create',$4)`, [req.auth!.organizationId, req.auth!.userId, category.rows[0].id, JSON.stringify(input)])
    res.status(201).json(category.rows[0])
  } catch (e) {
    if ((e as { code?: string }).code === '23505') return res.status(409).json({ error: 'Nama kategori sudah digunakan' })
    next(e)
  }
})

app.patch('/api/expense-categories/:id', settingsLimit, requireAuth, requireUserAdmin, async (req: AuthedRequest, res, next) => {
  try {
    const input = expenseCategoryLabelInput.parse(req.body), org = req.auth!.organizationId
    if (input.active === false) {
      const openBudgetUsage = await pool.query(`select count(*)::int count from budget_categories bc join budget_periods bp on bp.id=bc.budget_period_id where bc.expense_category_id=$1 and bp.organization_id=$2 and bp.status<>'closed' and bc.archived_at is null`, [req.params.id, org])
      if (openBudgetUsage.rows[0].count) return res.status(409).json({ error: 'Kategori masih digunakan oleh Pos RAB aktif. Ubah kategori pada Pos RAB terlebih dahulu.' })
      const active = await pool.query('select count(*)::int count from expense_categories where organization_id=$1 and active and id<>$2', [org, req.params.id])
      if (!active.rows[0].count) return res.status(409).json({ error: 'Minimal satu kategori harus tetap aktif' })
    }
    const category = await pool.query(`update expense_categories set name=$1,color=$2,active=coalesce($3,active),updated_at=now() where id=$4 and organization_id=$5 returning id,name,color,active`, [input.name, input.color, input.active ?? null, req.params.id, org])
    if (!category.rowCount) return res.status(404).json({ error: 'Kategori tidak ditemukan' })
    await pool.query(`insert into audit_logs(organization_id,actor_id,entity,entity_id,action,data) values($1,$2,'expense_category',$3,'update',$4)`, [org, req.auth!.userId, category.rows[0].id, JSON.stringify(input)])
    res.json(category.rows[0])
  } catch (e) {
    if ((e as { code?: string }).code === '23505') return res.status(409).json({ error: 'Nama kategori sudah digunakan' })
    next(e)
  }
})

app.delete('/api/expense-categories/:id', settingsLimit, requireAuth, requireUserAdmin, async (req: AuthedRequest, res, next) => {
  const c = await pool.connect()
  try {
    await c.query('begin')
    const org = req.auth!.organizationId, input = expenseCategoryMergeInput.parse(req.body || {})
    const category = await c.query('select id,name,active from expense_categories where id=$1 and organization_id=$2 for update', [req.params.id, org])
    if (!category.rowCount) {
      await c.query('rollback')
      return res.status(404).json({ error: 'Kategori tidak ditemukan' })
    }
    const usage = await c.query(`select
      (select count(*)::int from transactions t where t.expense_category_id=$1 and t.status<>'reversed' and t.kind<>'reversal' and not exists(select 1 from transactions r where r.reversal_of=t.id and r.status='posted')) "transactionCount",
      (select count(*)::int from transactions t where t.expense_category_id=$1 and (t.status='reversed' or t.kind='reversal' or exists(select 1 from transactions r where r.reversal_of=t.id and r.status='posted'))) "historyCount",
      (select count(*)::int from budget_categories where expense_category_id=$1) "budgetCount"`, [req.params.id])
    const requiresReplacement = Boolean(usage.rows[0].transactionCount || usage.rows[0].budgetCount)
    let replacement: { id: string; name: string } | null = null
    if (requiresReplacement) {
      if (!input.replacementCategoryId || input.replacementCategoryId === req.params.id) {
        await c.query('rollback')
        return res.status(409).json({ error: 'Pilih kategori pengganti sebelum menghapus kategori yang sudah digunakan.' })
      }
      const target = await c.query('select id,name from expense_categories where id=$1 and organization_id=$2 and active and id<>$3 for update', [input.replacementCategoryId, org, req.params.id])
      if (!target.rowCount) {
        await c.query('rollback')
        return res.status(400).json({ error: 'Kategori pengganti tidak valid atau sedang nonaktif.' })
      }
      const targetCategory = target.rows[0] as { id: string; name: string }
      replacement = targetCategory
      await c.query('update transactions set expense_category_id=$1 where expense_category_id=$2 and organization_id=$3', [targetCategory.id, req.params.id, org])
      await c.query(`update budget_categories bc set expense_category_id=$1,updated_at=now()
        from budget_periods bp where bc.budget_period_id=bp.id and bc.expense_category_id=$2 and bp.organization_id=$3`, [targetCategory.id, req.params.id, org])
    } else if (usage.rows[0].historyCount) {
      await c.query('update transactions set expense_category_id=null where expense_category_id=$1 and organization_id=$2', [req.params.id, org])
    }
    if (category.rows[0].active) {
      const remaining = await c.query('select count(*)::int count from expense_categories where organization_id=$1 and active and id<>$2', [org, req.params.id])
      if (!remaining.rows[0].count) {
        await c.query('rollback')
        return res.status(409).json({ error: 'Minimal satu kategori harus tetap aktif' })
      }
    }
    await c.query(`insert into audit_logs(organization_id,actor_id,entity,entity_id,action,data) values($1,$2,'expense_category',$3,$4,$5)`, [org, req.auth!.userId, category.rows[0].id, replacement ? 'merge_delete' : 'delete', JSON.stringify({ name: category.rows[0].name, usage: usage.rows[0], replacement })])
    await c.query('delete from expense_categories where id=$1 and organization_id=$2', [req.params.id, org])
    await c.query('commit')
    res.json({ ok: true, merged: Boolean(replacement), detachedHistory: Number(usage.rows[0].historyCount || 0), replacement })
  } catch (e) {
    await c.query('rollback')
    if ((e as { code?: string }).code === '23503') return res.status(409).json({ error: 'Kategori masih memiliki referensi lain dan belum dapat dihapus.' })
    next(e)
  } finally {
    c.release()
  }
})

app.patch('/api/settings/profile', settingsLimit, requireAuth, requireUserAdmin, async (req: AuthedRequest, res, next) => {
  try {
    const input = workspaceProfileInput.parse(req.body),
      org = req.auth!.organizationId
    await pool.query(`update organizations set name=$1,legal_name=nullif($2,''),tax_id=nullif($3,''),finance_email=nullif($4,''),address=nullif($5,''),timezone=$6,base_currency=$7 where id=$8`, [input.name, input.legalName, input.taxId, input.financeEmail, input.address, input.timezone, input.baseCurrency, org])
    await pool.query(`insert into audit_logs(organization_id,actor_id,entity,entity_id,action,data) values($1,$2,'organization',$1,'update_profile',$3)`, [
      org,
      req.auth!.userId,
      JSON.stringify({
        name: input.name,
        timezone: input.timezone,
        baseCurrency: input.baseCurrency,
      }),
    ])
    res.json({ ok: true })
  } catch (e) {
    next(e)
  }
})

app.patch('/api/settings/preferences', settingsLimit, requireAuth, requireUserAdmin, async (req: AuthedRequest, res, next) => {
  try {
    const input = workspacePreferenceInput.parse(req.body),
      org = req.auth!.organizationId
    if (input.defaultAccountId) {
      const account = await pool.query(`select 1 from accounts where id=$1 and organization_id=$2 and active and kind in('bank','cash','ewallet')`, [input.defaultAccountId, org])
      if (!account.rowCount) return res.status(400).json({ error: 'Rekening utama tidak valid' })
    }
    await pool.query(`insert into organization_settings(organization_id,default_account_id,transaction_prefix,purchase_prefix,minimum_cash_balance,updated_by) values($1,$2,$3,$4,$5,$6) on conflict(organization_id) do update set default_account_id=excluded.default_account_id,transaction_prefix=upper(excluded.transaction_prefix),purchase_prefix=upper(excluded.purchase_prefix),minimum_cash_balance=excluded.minimum_cash_balance,updated_by=excluded.updated_by,updated_at=now()`, [org, input.defaultAccountId || null, input.transactionPrefix.toUpperCase(), input.purchasePrefix.toUpperCase(), input.minimumCashBalance, req.auth!.userId])
    await pool.query(`insert into audit_logs(organization_id,actor_id,entity,entity_id,action,data) values($1,$2,'organization',$1,'update_preferences',$3)`, [
      org,
      req.auth!.userId,
      JSON.stringify({
        ...input,
        defaultAccountId: input.defaultAccountId || null,
      }),
    ])
    res.json({ ok: true })
  } catch (e) {
    next(e)
  }
})

app.patch('/api/settings/notifications', settingsLimit, requireAuth, requireUserAdmin, async (req: AuthedRequest, res, next) => {
  try {
    const input = notificationInput.parse(req.body),
      org = req.auth!.organizationId
    await pool.query(`insert into organization_settings(organization_id,bill_reminder_days,notify_bills,notify_low_deposit,notify_purchase_approval,notify_reconciliation,updated_by) values($1,$2,$3,$4,$5,$6,$7) on conflict(organization_id) do update set bill_reminder_days=excluded.bill_reminder_days,notify_bills=excluded.notify_bills,notify_low_deposit=excluded.notify_low_deposit,notify_purchase_approval=excluded.notify_purchase_approval,notify_reconciliation=excluded.notify_reconciliation,updated_by=excluded.updated_by,updated_at=now()`, [org, input.billReminderDays, input.notifyBills, input.notifyLowDeposit, input.notifyPurchaseApproval, input.notifyReconciliation, req.auth!.userId])
    await pool.query(`insert into audit_logs(organization_id,actor_id,entity,entity_id,action,data) values($1,$2,'organization',$1,'update_notifications',$3)`, [org, req.auth!.userId, JSON.stringify(input)])
    res.json({ ok: true })
  } catch (e) {
    next(e)
  }
})

app.patch('/api/settings/governance', settingsLimit, requireAuth, requireUserAdmin, async (req: AuthedRequest, res, next) => {
  try {
    const input = governanceInput.parse(req.body),
      org = req.auth!.organizationId
    await pool.query(`insert into organization_settings(organization_id,owner_approval_threshold,session_hours,updated_by) values($1,$2,$3,$4) on conflict(organization_id) do update set owner_approval_threshold=excluded.owner_approval_threshold,session_hours=excluded.session_hours,updated_by=excluded.updated_by,updated_at=now()`, [org, input.ownerApprovalThreshold, input.sessionHours, req.auth!.userId])
    await pool.query(`insert into audit_logs(organization_id,actor_id,entity,entity_id,action,data) values($1,$2,'organization',$1,'update_governance',$3)`, [org, req.auth!.userId, JSON.stringify(input)])
    res.json({ ok: true })
  } catch (e) {
    next(e)
  }
})

app.post('/api/auth/change-password', authLimit, requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const input = z
        .object({
          currentPassword: z.string().min(12).max(128),
          newPassword: z.string().min(12).max(128),
        })
        .refine((value) => value.currentPassword !== value.newPassword, {
          message: 'Kata sandi baru harus berbeda',
          path: ['newPassword'],
        })
        .parse(req.body),
      user = await pool.query('select password_hash from users where id=$1', [req.auth!.userId])
    if (!user.rowCount || !(await verifyPassword(input.currentPassword, user.rows[0].password_hash))) return res.status(400).json({ error: 'Kata sandi saat ini tidak sesuai' })
    const hash = await hashPassword(input.newPassword),
      currentHash = tokenHash(req.cookies[cookieName])
    const c = await pool.connect()
    try {
      await c.query('begin')
      await c.query('update users set password_hash=$1 where id=$2', [hash, req.auth!.userId])
      await c.query('delete from sessions where user_id=$1 and token_hash<>$2', [req.auth!.userId, currentHash])
      await c.query(`insert into audit_logs(organization_id,actor_id,entity,entity_id,action,data) values($1,$2,'user',$2,'change_password',$3)`, [req.auth!.organizationId, req.auth!.userId, JSON.stringify({ otherSessionsRevoked: true })])
      await c.query('commit')
    } catch (e) {
      await c.query('rollback')
      throw e
    } finally {
      c.release()
    }
    res.json({ ok: true })
  } catch (e) {
    next(e)
  }
})

app.get('/api/auth/sessions', requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const currentHash = tokenHash(req.cookies[cookieName]),
      sessions = await pool.query(`select id,created_at "createdAt",last_seen_at "lastSeenAt",expires_at "expiresAt",token_hash=$2 current from sessions where user_id=$1 and expires_at>now() order by current desc,last_seen_at desc`, [req.auth!.userId, currentHash])
    res.json({ sessions: sessions.rows })
  } catch (e) {
    next(e)
  }
})
app.delete('/api/auth/sessions/others', settingsLimit, requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const currentHash = tokenHash(req.cookies[cookieName]),
      deleted = await pool.query('delete from sessions where user_id=$1 and token_hash<>$2 returning id', [req.auth!.userId, currentHash])
    await pool.query(`insert into audit_logs(organization_id,actor_id,entity,entity_id,action,data) values($1,$2,'user',$2,'revoke_sessions',$3)`, [req.auth!.organizationId, req.auth!.userId, JSON.stringify({ count: deleted.rowCount })])
    res.json({ ok: true, count: deleted.rowCount })
  } catch (e) {
    next(e)
  }
})

function csvCell(value: unknown) {
  const text = String(value ?? '')
  return `"${text.replaceAll('"', '""')}"`
}
app.get('/api/exports/transactions.csv', requireAuth, requireFinance, async (req: AuthedRequest, res, next) => {
  try {
    const rows = await pool.query(`select t.transaction_date date,t.kind,t.status,t.description,t.category,coalesce(t.reference,'') reference,coalesce(t.counterparty,'') counterparty,coalesce((select string_agg(tbi.item_name||' ('||tbi.quantity||' x '||tbi.actual_unit_price||')',', ' order by tbi.created_at) from transaction_budget_items tbi where tbi.transaction_id=t.id),'') "budgetItems",coalesce((select abs(e.amount) from transaction_entries e join accounts a on a.id=e.account_id where e.transaction_id=t.id and a.kind in('bank','cash','ewallet','deposit') order by abs(e.amount) desc limit 1),0)::numeric amount from transactions t where t.organization_id=$1 order by t.transaction_date desc,t.created_at desc`, [req.auth!.organizationId]),
      header = ['Tanggal', 'Jenis', 'Status', 'Deskripsi', 'Kategori', 'Referensi', 'Pihak terkait', 'Rincian RAB', 'Nominal'],
      csv = [header, ...rows.rows.map((row) => [row.date instanceof Date ? row.date.toISOString().slice(0, 10) : row.date, row.kind, row.status, row.description, row.category, row.reference, row.counterparty, row.budgetItems, row.amount])].map((line) => line.map(csvCell).join(',')).join('\n')
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="emisell-transaksi-${new Date().toISOString().slice(0, 10)}.csv"`)
    res.send(`\uFEFF${csv}`)
  } catch (e) {
    next(e)
  }
})

app.get('/api/backups', requireAuth, requireUserAdmin, async (req: AuthedRequest, res, next) => {
  try {
    const backups = await pool.query(`select b.id,b.created_at "createdAt",b.item_count "itemCount",coalesce(u.full_name,'Sistem') "createdBy" from data_backups b left join users u on u.id=b.created_by where b.organization_id=$1 order by b.created_at desc limit 20`, [req.auth!.organizationId])
    res.json({ backups: backups.rows })
  } catch (e) {
    next(e)
  }
})
app.post('/api/backups', settingsLimit, requireAuth, requireUserAdmin, async (req: AuthedRequest, res, next) => {
  try {
    const org = req.auth!.organizationId,
      c = await pool.connect()
    try {
      await c.query('begin')
      const organization = await c.query(`select id,name,legal_name,tax_id,finance_email,address,timezone,base_currency,created_at from organizations where id=$1`, [org]),
        accounts = await c.query(`select * from accounts where organization_id=$1`, [org]),
        transactions = await c.query(`select * from transactions where organization_id=$1`, [org]),
        entries = await c.query(`select e.* from transaction_entries e join transactions t on t.id=e.transaction_id where t.organization_id=$1`, [org]),
        transactionBudgetItems = await c.query(`select tbi.* from transaction_budget_items tbi join transactions t on t.id=tbi.transaction_id where t.organization_id=$1`, [org]),
        bills = await c.query(`select * from bills where organization_id=$1 and archived_at is null`, [org]),
        purchases = await c.query(`select * from purchase_requests where organization_id=$1`, [org]),
        items = await c.query(`select i.* from purchase_request_items i join purchase_requests p on p.id=i.purchase_request_id where p.organization_id=$1`, [org]),
        budgets = await c.query(`select * from budget_periods where organization_id=$1`, [org]),
        categories = await c.query(`select bc.* from budget_categories bc join budget_periods bp on bp.id=bc.budget_period_id where bp.organization_id=$1`, [org]),
        expenseCategories = await c.query(`select * from expense_categories where organization_id=$1`, [org]),
        reconciliations = await c.query(`select * from account_reconciliations where organization_id=$1`, [org]),
        audit = await c.query(`select * from audit_logs where organization_id=$1 order by created_at desc limit 5000`, [org])
      const snapshot = {
          version: 1,
          exportedAt: new Date().toISOString(),
          organization: organization.rows[0],
          accounts: accounts.rows,
          transactions: transactions.rows,
          transactionEntries: entries.rows,
          transactionBudgetItems: transactionBudgetItems.rows,
          bills: bills.rows,
          purchaseRequests: purchases.rows,
          purchaseRequestItems: items.rows,
          budgets: budgets.rows,
          budgetCategories: categories.rows,
          expenseCategories: expenseCategories.rows,
          reconciliations: reconciliations.rows,
          auditLogs: audit.rows,
        },
        itemCount = accounts.rows.length + transactions.rows.length + transactionBudgetItems.rows.length + bills.rows.length + purchases.rows.length + budgets.rows.length,
        backup = await c.query(`insert into data_backups(organization_id,created_by,snapshot,item_count) values($1,$2,$3,$4) returning id,created_at "createdAt",item_count "itemCount"`, [org, req.auth!.userId, JSON.stringify(snapshot), itemCount])
      await c.query(`delete from data_backups where organization_id=$1 and id not in(select id from data_backups where organization_id=$1 order by created_at desc limit 20)`, [org])
      await c.query(`insert into audit_logs(organization_id,actor_id,entity,entity_id,action,data) values($1,$2,'backup',$3,'create',$4)`, [org, req.auth!.userId, backup.rows[0].id, JSON.stringify({ itemCount })])
      await c.query('commit')
      res.status(201).json(backup.rows[0])
    } catch (e) {
      await c.query('rollback')
      throw e
    } finally {
      c.release()
    }
  } catch (e) {
    next(e)
  }
})
app.get('/api/backups/:id/download', requireAuth, requireUserAdmin, async (req: AuthedRequest, res, next) => {
  try {
    const backup = await pool.query('select snapshot,created_at from data_backups where id=$1 and organization_id=$2', [req.params.id, req.auth!.organizationId])
    if (!backup.rowCount) return res.status(404).json({ error: 'Backup tidak ditemukan' })
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="emisell-backup-${new Date(backup.rows[0].created_at).toISOString().slice(0, 10)}.json"`)
    res.send(JSON.stringify(backup.rows[0].snapshot, null, 2))
  } catch (e) {
    next(e)
  }
})

app.post('/api/purchase-requests/:id/transition', requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    if (req.body?.status !== 'approved' || req.auth!.role === 'owner') return next()
    const check = await pool.query(`select p.estimated_total::numeric amount,coalesce(s.owner_approval_threshold,10000000)::numeric threshold from purchase_requests p left join organization_settings s on s.organization_id=p.organization_id where p.id=$1 and p.organization_id=$2`, [req.params.id, req.auth!.organizationId])
    if (!check.rowCount) return next()
    const amount = Number(check.rows[0].amount),
      threshold = Number(check.rows[0].threshold)
    if (threshold > 0 && amount >= threshold)
      return res.status(403).json({
        error: `Pengajuan senilai Rp ${amount.toLocaleString('id-ID')} memerlukan persetujuan Owner`,
      })
    next()
  } catch (e) {
    next(e)
  }
})

app.get('/api/bootstrap', requireAuth, async (req: AuthedRequest, res) => {
  const org = req.auth!.organizationId
  const [organization, accounts, transactions, bills, purchases, settings] = await Promise.all([
    pool.query('select id,name,base_currency "baseCurrency" from organizations where id=$1', [org]),
    pool.query(
      `select a.id,a.name,coalesce(a.institution,'') institution,a.kind,coalesce(a.masked_number,'') "maskedNumber",a.currency,a.color,a.credit_limit "creditLimit",a.low_balance_threshold "lowBalanceThreshold",a.opening_balance+coalesce(sum(case when t.status='posted' then e.amount else 0 end),0)::numeric balance,
    coalesce((select ar.difference=0 from account_reconciliations ar where ar.account_id=a.id order by ar.statement_date desc,ar.created_at desc limit 1),false) reconciled,
    (select to_char(ar.statement_date,'YYYY-MM-DD') from account_reconciliations ar where ar.account_id=a.id order by ar.statement_date desc,ar.created_at desc limit 1) "lastReconciledAt",
    coalesce((select ar.difference from account_reconciliations ar where ar.account_id=a.id order by ar.statement_date desc,ar.created_at desc limit 1),0)::numeric "reconciliationDifference",
    coalesce((select sum(-de.amount) from transaction_entries de join transactions dt on dt.id=de.transaction_id where de.account_id=a.id and dt.status='posted' and dt.kind='deposit_usage' and date_trunc('month',dt.transaction_date)=date_trunc('month',current_date)),0)::numeric "monthlyUsage",
    coalesce((select sum(-de.amount)/30 from transaction_entries de join transactions dt on dt.id=de.transaction_id where de.account_id=a.id and dt.status='posted' and dt.kind='deposit_usage' and dt.transaction_date>current_date-interval '30 days'),0)::numeric "dailyAverage"
    from accounts a left join transaction_entries e on e.account_id=a.id left join transactions t on t.id=e.transaction_id where a.organization_id=$1 and a.active group by a.id order by a.created_at`,
      [org],
    ),
    pool.query(
      `select t.id,to_char(t.transaction_date,'YYYY-MM-DD') date,t.description,coalesce((select ec.name from expense_categories ec where ec.id=t.expense_category_id),t.category) category,t.kind,t.status,coalesce(t.reference,'') reference,coalesce(t.counterparty,'') counterparty,coalesce(t.invoice_number,'') "invoiceNumber",coalesce(t.income_source,'') "incomeSource",coalesce(t.payment_method,'') "paymentMethod",coalesce(t.proof_url,'') "proofUrl",coalesce(t.budget_category_id::text,'') "budgetCategoryId",coalesce(t.budget_item_name,'') "budgetItemName",coalesce((select jsonb_agg(jsonb_build_object('budgetItemId',tbi.budget_item_id,'itemName',tbi.item_name,'quantity',tbi.quantity,'plannedUnitPrice',tbi.planned_unit_price,'actualUnitPrice',tbi.actual_unit_price,'subtotal',tbi.subtotal) order by tbi.created_at) from transaction_budget_items tbi where tbi.transaction_id=t.id),'[]'::jsonb) "budgetItems",coalesce((select ea.id::text from transaction_entries e join accounts ea on ea.id=e.account_id where e.transaction_id=t.id and ea.kind<>'clearing' order by abs(e.amount) desc limit 1),'') "accountId",(t.kind in('income','expense') and not exists(select 1 from bills b where b.paid_transaction_id=t.id)) editable,coalesce((select e.amount from transaction_entries e join accounts ea on ea.id=e.account_id where e.transaction_id=t.id and ea.kind<>'clearing' order by case when t.kind in('deposit_topup','deposit_usage') and ea.kind='deposit' then 0 else 1 end,abs(e.amount) desc limit 1),0)::numeric amount,coalesce((select ea.name from transaction_entries e join accounts ea on ea.id=e.account_id where e.transaction_id=t.id and ea.kind<>'clearing' order by case when t.kind in('deposit_topup','deposit_usage') and ea.kind='deposit' then 0 else 1 end,abs(e.amount) desc limit 1),'') account from transactions t where t.organization_id=$1 and t.status<>'reversed' and t.kind<>'reversal' and not exists(select 1 from transactions r where r.reversal_of=t.id and r.status='posted') order by t.transaction_date desc,t.created_at desc limit 100`,
      [org],
    ),
    pool.query(`select id,vendor,description,to_char(due_date,'YYYY-MM-DD') "dueDate",amount::numeric,unit_price::numeric "unitPrice",quantity::numeric,coalesce(payment_method,'') "paymentMethod",currency,recurrence,case when status='paid' then 'paid' when due_date<current_date then 'overdue' when due_date<=current_date+interval '7 days' then 'due' else 'upcoming' end status,coalesce(owner_name,'') owner,auto_renew "autoRenew",reminder_days "reminderDays",paid_transaction_id "paidTransactionId" from bills where organization_id=$1 and status<>'cancelled' and archived_at is null order by case when status='paid' then 1 else 0 end,due_date`, [org]),
    pool.query(`select p.id,p.request_number "requestNumber",to_char(p.created_at::date,'YYYY-MM-DD') "requestedAt",p.requested_by "requestedById",u.full_name "requestedBy",p.department,p.title,p.purpose,(select count(*)::int from purchase_request_items i where i.purchase_request_id=p.id) "itemCount",p.estimated_total::numeric amount,case when p.urgency='urgent' then 'Mendesak' else 'Normal' end urgency,p.status,coalesce(p.vendor,'') vendor,p.budget_category_id "budgetCategoryId",coalesce(bc.name,'') "budgetCategory",p.payment_transaction_id "paymentTransactionId",p.paid_amount::numeric "paidAmount",p.paid_at "paidAt",coalesce(p.payment_reference,'') "paymentReference",coalesce(p.proof_reference,'') "proofReference" from purchase_requests p join users u on u.id=p.requested_by left join budget_categories bc on bc.id=p.budget_category_id where p.organization_id=$1 order by p.created_at desc`, [org]),
    pool.query(`select coalesce(default_account_id::text,'') "defaultAccountId",minimum_cash_balance::numeric "minimumCashBalance",notify_bills "notifyBills",notify_low_deposit "notifyLowDeposit",notify_purchase_approval "notifyPurchaseApproval",notify_reconciliation "notifyReconciliation" from organization_settings where organization_id=$1`, [org]),
  ])
  res.json({
    organization: organization.rows[0],
    user: req.auth,
    accounts: accounts.rows,
    transactions: transactions.rows,
    bills: bills.rows,
    purchaseRequests: purchases.rows,
    settings: settings.rows[0] || {},
  })
})

const accountInput = z.object({
  name: z.string().trim().min(2).max(100),
  institution: z.string().trim().max(100).optional(),
  kind: z.enum(['bank', 'cash', 'ewallet', 'deposit']),
  maskedNumber: z.string().trim().max(20).optional(),
  currency: z.enum(['IDR', 'USD']).default('IDR'),
  openingBalance: z.number().nonnegative().max(1e15).default(0),
  lowBalanceThreshold: z.number().nonnegative().max(1e15).optional(),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .default('#225c55'),
})

app.post('/api/accounts', requireAuth, requireFinance, async (req: AuthedRequest, res, next) => {
  try {
    const input = accountInput.parse(req.body),
      org = req.auth!.organizationId,
      c = await pool.connect()
    try {
      await c.query('begin')
      const account = await c.query(`insert into accounts(organization_id,name,institution,kind,masked_number,currency,low_balance_threshold,color) values($1,$2,$3,$4,$5,$6,$7,$8) returning id`, [org, input.name, input.institution || null, input.kind, input.maskedNumber || null, input.currency, input.lowBalanceThreshold || null, input.color])
      if (input.openingBalance > 0) {
        await c.query(`insert into accounts(organization_id,name,kind,currency,color) values($1,'Saldo Awal','clearing',$2,'#607d73') on conflict(organization_id,name) do nothing`, [org, input.currency])
        const counterpart = await c.query(`select id from accounts where organization_id=$1 and name='Saldo Awal' and currency=$2 and active`, [org, input.currency])
        const transaction = await c.query(`insert into transactions(organization_id,transaction_date,kind,status,description,category,created_by,posted_by,posted_at) values($1,current_date,'adjustment','posted',$2,'Saldo awal',$3,$3,now()) returning id`, [org, `Saldo awal ${input.name}`, req.auth!.userId])
        await c.query(`insert into transaction_entries(transaction_id,account_id,amount) values($1,$2,$3),($1,$4,$5)`, [transaction.rows[0].id, account.rows[0].id, input.openingBalance, counterpart.rows[0].id, -input.openingBalance])
      }
      await c.query(`insert into audit_logs(organization_id,actor_id,entity,entity_id,action,data) values($1,$2,'account',$3,'create',$4)`, [
        org,
        req.auth!.userId,
        account.rows[0].id,
        JSON.stringify({
          name: input.name,
          kind: input.kind,
          openingBalance: input.openingBalance,
        }),
      ])
      await c.query('commit')
      res.status(201).json({ id: account.rows[0].id })
    } catch (e) {
      await c.query('rollback')
      if ((e as { code?: string }).code === '23505') return res.status(409).json({ error: 'Nama rekening sudah digunakan' })
      throw e
    } finally {
      c.release()
    }
  } catch (e) {
    next(e)
  }
})

const accountEditInput = accountInput.omit({ openingBalance: true })
app.patch('/api/accounts/:id', requireAuth, requireFinance, async (req: AuthedRequest, res, next) => {
  try {
    const input = accountEditInput.parse(req.body),
      org = req.auth!.organizationId
    const updated = await pool.query(`update accounts set name=$1,institution=$2,kind=$3,masked_number=$4,currency=$5,low_balance_threshold=$6,color=$7,updated_at=now() where id=$8 and organization_id=$9 and active and kind<>'clearing' returning id`, [input.name, input.institution || null, input.kind, input.maskedNumber || null, input.currency, input.lowBalanceThreshold || null, input.color, req.params.id, org])
    if (!updated.rowCount) return res.status(404).json({ error: 'Rekening tidak ditemukan' })
    await pool.query(`insert into audit_logs(organization_id,actor_id,entity,entity_id,action,data) values($1,$2,'account',$3,'update',$4)`, [org, req.auth!.userId, req.params.id, JSON.stringify(input)])
    res.json({ ok: true })
  } catch (e) {
    if ((e as { code?: string }).code === '23505') return res.status(409).json({ error: 'Nama rekening sudah digunakan' })
    next(e)
  }
})
app.delete('/api/accounts/:id', requireAuth, requireFinance, async (req: AuthedRequest, res, next) => {
  try {
    const org = req.auth!.organizationId
    const setting = await pool.query('select 1 from organization_settings where organization_id=$1 and default_account_id=$2', [org, req.params.id])
    if (setting.rowCount)
      return res.status(409).json({
        error: 'Rekening utama tidak dapat dihapus. Ubah rekening utama di Pengaturan terlebih dahulu.',
      })
    const balance = await pool.query(`select a.opening_balance+coalesce(sum(case when t.status='posted' then e.amount else 0 end),0)::numeric balance from accounts a left join transaction_entries e on e.account_id=a.id left join transactions t on t.id=e.transaction_id where a.id=$1 and a.organization_id=$2 and a.active group by a.id`, [req.params.id, org])
    if (!balance.rowCount) return res.status(404).json({ error: 'Rekening tidak ditemukan' })
    if (Math.abs(Number(balance.rows[0].balance)) > 0.005) return res.status(409).json({ error: 'Rekening masih memiliki saldo. Pindahkan atau gunakan seluruh saldo sebelum menghapusnya.' })
    const removed = await pool.query(`update accounts set active=false,updated_at=now() where id=$1 and organization_id=$2 and active and kind<>'clearing' returning id`, [req.params.id, org])
    if (!removed.rowCount) return res.status(404).json({ error: 'Rekening tidak ditemukan' })
    await pool.query(`insert into audit_logs(organization_id,actor_id,entity,entity_id,action,data) values($1,$2,'account',$3,'deactivate','{}')`, [org, req.auth!.userId, req.params.id])
    res.json({ ok: true })
  } catch (e) {
    next(e)
  }
})

app.post('/api/accounts/:id/reconcile', requireAuth, requireFinance, async (req: AuthedRequest, res, next) => {
  try {
    const input = z
        .object({
          statementDate: z.iso.date(),
          statementBalance: z.number().min(-1e15).max(1e15),
          note: z.string().trim().max(500).optional(),
        })
        .parse(req.body),
      org = req.auth!.organizationId,
      c = await pool.connect()
    try {
      await c.query('begin')
      const account = await c.query(`select id,opening_balance from accounts where id=$1 and organization_id=$2 and active for update`, [req.params.id, org])
      if (!account.rowCount) {
        await c.query('rollback')
        return res.status(404).json({ error: 'Rekening tidak ditemukan' })
      }
      const entries = await c.query(`select coalesce(sum(case when t.status='posted' then e.amount else 0 end),0)::numeric amount from transaction_entries e join transactions t on t.id=e.transaction_id where e.account_id=$1`, [account.rows[0].id]),
        ledgerBalance = Number(account.rows[0].opening_balance) + Number(entries.rows[0].amount)
      const reconciliation = await c.query(`insert into account_reconciliations(organization_id,account_id,statement_date,ledger_balance,statement_balance,note,reconciled_by) values($1,$2,$3::date,$4,$5,$6,$7) returning id,difference::numeric`, [org, account.rows[0].id, input.statementDate, ledgerBalance, input.statementBalance, input.note || null, req.auth!.userId])
      await c.query(`insert into audit_logs(organization_id,actor_id,entity,entity_id,action,data) values($1,$2,'account',$3,'reconcile',$4)`, [
        org,
        req.auth!.userId,
        account.rows[0].id,
        JSON.stringify({
          statementDate: input.statementDate,
          ledgerBalance,
          statementBalance: input.statementBalance,
          difference: Number(reconciliation.rows[0].difference),
        }),
      ])
      await c.query('commit')
      res.status(201).json({
        id: reconciliation.rows[0].id,
        difference: Number(reconciliation.rows[0].difference),
      })
    } catch (e) {
      await c.query('rollback')
      throw e
    } finally {
      c.release()
    }
  } catch (e) {
    next(e)
  }
})

async function assertBudgetAvailable(c: import('pg').PoolClient, org: string, categoryId: string, amount: number, purchaseRequestId: string | undefined, role: Auth['role'], overrideReason?: string) {
  const category = await c.query(`select bc.id,bc.name,bc.planned_amount::numeric planned,bp.status from budget_categories bc join budget_periods bp on bp.id=bc.budget_period_id where bc.id=$1 and bp.organization_id=$2 and bc.archived_at is null for update of bc,bp`, [categoryId, org])
  if (!category.rowCount)
    throw Object.assign(new Error('Pos anggaran tidak valid'), {
      statusCode: 400,
    })
  if (category.rows[0].status === 'closed')
    throw Object.assign(new Error('Periode RAB sudah ditutup'), {
      statusCode: 409,
    })
  const used = await c.query(`select coalesce((select sum(-te.amount) from transactions t join transaction_entries te on te.transaction_id=t.id join accounts a on a.id=te.account_id where t.organization_id=$1 and t.budget_category_id=$2 and t.status='posted' and a.kind in('bank','cash','ewallet','deposit')),0)::numeric actual,coalesce((select sum(pr.estimated_total) from purchase_requests pr where pr.organization_id=$1 and pr.budget_category_id=$2 and pr.status='approved' and ($3::uuid is null or pr.id<>$3)),0)::numeric committed`, [org, categoryId, purchaseRequestId || null])
  const projected = Number(used.rows[0].actual) + Number(used.rows[0].committed) + amount
  if (projected > Number(category.rows[0].planned)) {
    if (!overrideReason || overrideReason.trim().length < 5) throw Object.assign(new Error(`Anggaran ${category.rows[0].name} tidak mencukupi. Diperlukan alasan override.`), { statusCode: 409 })
    if (!['owner', 'admin'].includes(role)) throw Object.assign(new Error('Hanya Owner atau Admin yang dapat menyetujui kelebihan anggaran'), { statusCode: 403 })
    return {
      overridden: true,
      projected,
      planned: Number(category.rows[0].planned),
    }
  }
  return {
    overridden: false,
    projected,
    planned: Number(category.rows[0].planned),
  }
}

const incomeSources = {
  product_sale: { category: 'Penjualan produk', counterpart: 'Pendapatan' },
  service_income: { category: 'Pendapatan jasa', counterpart: 'Pendapatan' },
  invoice_payment: {
    category: 'Pembayaran invoice',
    counterpart: 'Pendapatan',
  },
  commission: { category: 'Komisi/afiliasi', counterpart: 'Pendapatan' },
  interest: { category: 'Pendapatan bunga', counterpart: 'Pendapatan' },
  vendor_refund: { category: 'Refund vendor', counterpart: 'Pengeluaran' },
  owner_capital: {
    category: 'Setoran modal pemilik',
    counterpart: 'Modal Pemilik',
  },
  company_loan: {
    category: 'Pinjaman perusahaan',
    counterpart: 'Pinjaman Perusahaan',
  },
  other: { category: 'Pendapatan lainnya', counterpart: 'Pendapatan' },
} as const
const paymentMethod = z.enum(['transfer', 'ewallet', 'cash'])
const proofUrl = z.url().max(500).optional()
const incomeInput = z.object({
  transactionDate: z.iso.date(),
  amount: z.number().positive().max(1e15),
  accountId: z.string().uuid(),
  description: z.string().trim().min(3).max(240),
  sourceType: z.enum(Object.keys(incomeSources) as [keyof typeof incomeSources, ...Array<keyof typeof incomeSources>]),
  counterparty: z.string().trim().max(120).optional(),
  paymentMethod,
  proofUrl,
})

app.post('/api/income', requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const input = incomeInput.parse(req.body)
    const source = incomeSources[input.sourceType],
      org = req.auth!.organizationId,
      c = await pool.connect()
    try {
      await c.query('begin')
      const destination = await c.query(`select id,currency from accounts where id=$1 and organization_id=$2 and active and kind in('bank','cash','ewallet') for update`, [input.accountId, org])
      if (!destination.rowCount) {
        await c.query('rollback')
        return res.status(400).json({ error: 'Rekening penerima tidak valid atau tidak aktif' })
      }
      await c.query(`insert into accounts(organization_id,name,kind,currency,color) values($1,$2,'clearing',$3,$4) on conflict(organization_id,name) do nothing`, [org, source.counterpart, destination.rows[0].currency, input.sourceType === 'owner_capital' ? '#607d73' : input.sourceType === 'company_loan' ? '#776a91' : '#225c55'])
      const counterpart = await c.query(`select id from accounts where organization_id=$1 and name=$2 and kind='clearing' and active`, [org, source.counterpart])
      if (!counterpart.rowCount) {
        await c.query('rollback')
        return res.status(409).json({ error: 'Akun penyeimbang tidak tersedia' })
      }
      const posted = ['owner', 'admin', 'finance'].includes(req.auth!.role)
      const transaction = await c.query(`insert into transactions(organization_id,transaction_date,kind,status,description,category,counterparty,income_source,payment_method,proof_url,created_by,posted_by,posted_at) values($1,$2::date,'income',$3,$4,$5,$6,$7,$8,$9,$10,$11,case when $12::boolean then now() else null end) returning id,status`, [org, input.transactionDate, posted ? 'posted' : 'pending', input.description, source.category, input.counterparty || null, input.sourceType, input.paymentMethod, input.proofUrl || null, req.auth!.userId, posted ? req.auth!.userId : null, posted])
      await c.query(`insert into transaction_entries(transaction_id,account_id,amount) values($1,$2,$3),($1,$4,$5)`, [transaction.rows[0].id, destination.rows[0].id, input.amount, counterpart.rows[0].id, -input.amount])
      const balance = await c.query('select count(*)::int count,coalesce(sum(amount),0)::numeric balance from transaction_entries where transaction_id=$1', [transaction.rows[0].id])
      if (balance.rows[0].count !== 2 || Number(balance.rows[0].balance) !== 0) throw new Error('Unbalanced income transaction')
      await c.query(`insert into audit_logs(organization_id,actor_id,entity,entity_id,action,data) values($1,$2,'transaction',$3,$4,$5)`, [
        org,
        req.auth!.userId,
        transaction.rows[0].id,
        posted ? 'create_and_post' : 'create_pending',
        JSON.stringify({
          sourceType: input.sourceType,
          amount: input.amount,
          accountId: input.accountId,
        }),
      ])
      await c.query('commit')
      res.status(201).json(transaction.rows[0])
    } catch (e) {
      await c.query('rollback')
      throw e
    } finally {
      c.release()
    }
  } catch (e) {
    next(e)
  }
})

const expenseInput = z.object({
  transactionDate: z.iso.date(),
  amount: z.number().positive().max(1e15),
  accountId: z.string().uuid(),
  description: z.string().trim().min(3).max(240),
  category: z.string().trim().min(2).max(80),
  budgetCategoryId: z.string().uuid().optional(),
  budgetItemName: z.string().trim().min(2).max(80).optional(),
  budgetItems: z.array(z.object({
    budgetItemId: z.string().uuid(),
    quantity: z.number().int().positive().max(1e6),
    unitPrice: z.number().nonnegative().max(1e15),
  })).max(30).optional(),
  counterparty: z.string().trim().max(120).optional(),
  paymentMethod,
  proofUrl,
  overrideReason: z.string().trim().max(500).optional(),
})

async function assertBudgetItem(c: import('pg').PoolClient, org: string, categoryId: string, itemName?: string) {
  if (!itemName) return
  const item = await c.query(`select 1 from budget_categories bc join budget_periods bp on bp.id=bc.budget_period_id where bc.id=$1 and bp.organization_id=$2 and bc.archived_at is null and exists(select 1 from jsonb_array_elements(bc.line_items) line where line->>'name'=$3)`, [categoryId, org, itemName])
  if (!item.rowCount) throw Object.assign(new Error('Item RAB tidak valid atau sudah berubah'), { statusCode: 400 })
}

type ExpenseBudgetItemInput = { budgetItemId: string; quantity: number; unitPrice: number }
async function validateBudgetCart(c: import('pg').PoolClient, org: string, categoryId: string, items: ExpenseBudgetItemInput[], amount: number) {
  const category = await c.query(`select bc.id,bc.budget_model,bc.line_items from budget_categories bc join budget_periods bp on bp.id=bc.budget_period_id where bc.id=$1 and bp.organization_id=$2 and bp.status<>'closed' and bc.archived_at is null for update of bc`, [categoryId, org])
  if (!category.rowCount) throw Object.assign(new Error('Pos RAB tidak valid atau periodenya sudah ditutup'), { statusCode: 400 })
  if (category.rows[0].budget_model !== 'multi_item') {
    if (items.length) throw Object.assign(new Error('Rincian item hanya dapat digunakan pada Pos RAB multi-item'), { statusCode: 400 })
    return [] as Array<{ budgetItemId: string; itemName: string; quantity: number; plannedUnitPrice: number; actualUnitPrice: number; subtotal: number }>
  }
  if (!items.length) throw Object.assign(new Error('Pilih minimal satu rincian item RAB'), { statusCode: 400 })
  if (new Set(items.map((item) => item.budgetItemId)).size !== items.length) throw Object.assign(new Error('Item RAB yang sama tidak boleh dipilih dua kali'), { statusCode: 400 })
  const definitions = new Map((category.rows[0].line_items as Array<{ id: string; name: string; quantity: number; unitPrice: number }>).map((item) => [item.id, item]))
  const used = await c.query(`select tbi.budget_item_id::text id,coalesce(sum(tbi.quantity),0)::int quantity
    from transaction_budget_items tbi join transactions t on t.id=tbi.transaction_id
    where tbi.budget_category_id=$1 and t.status='posted' and t.kind='expense'
      and not exists(select 1 from transactions r where r.reversal_of=t.id and r.status='posted')
    group by tbi.budget_item_id`, [categoryId])
  const usedById = new Map(used.rows.map((row) => [row.id as string, Number(row.quantity)]))
  const normalized = items.map((requested) => {
    const definition = definitions.get(requested.budgetItemId)
    if (!definition) throw Object.assign(new Error('Item RAB tidak valid atau sudah berubah'), { statusCode: 400 })
    const remaining = Number(definition.quantity) - (usedById.get(requested.budgetItemId) || 0)
    if (requested.quantity > remaining) throw Object.assign(new Error(`${definition.name}: qty pembelian ${requested.quantity} melebihi sisa kebutuhan ${Math.max(0, remaining)}`), { statusCode: 409 })
    return { budgetItemId: requested.budgetItemId, itemName: definition.name, quantity: requested.quantity, plannedUnitPrice: Number(definition.unitPrice), actualUnitPrice: requested.unitPrice, subtotal: requested.quantity * requested.unitPrice }
  })
  const total = normalized.reduce((sum, item) => sum + item.subtotal, 0)
  if (Math.abs(total - amount) > 0.01) throw Object.assign(new Error('Nominal transaksi harus sama dengan total item yang dipilih'), { statusCode: 400 })
  return normalized
}

async function insertBudgetCart(c: import('pg').PoolClient, transactionId: string, budgetCategoryId: string, items: Awaited<ReturnType<typeof validateBudgetCart>>) {
  for (const item of items) await c.query(`insert into transaction_budget_items(transaction_id,budget_category_id,budget_item_id,item_name,quantity,planned_unit_price,actual_unit_price,subtotal) values($1,$2,$3,$4,$5,$6,$7,$8)`, [transactionId, budgetCategoryId, item.budgetItemId, item.itemName, item.quantity, item.plannedUnitPrice, item.actualUnitPrice, item.subtotal])
}

app.post('/api/expenses', requireAuth, requireFinance, async (req: AuthedRequest, res, next) => {
  try {
    const input = expenseInput.parse(req.body),
      org = req.auth!.organizationId,
      c = await pool.connect()
    try {
      await c.query('begin')
      const source = await c.query(`select id,currency from accounts where id=$1 and organization_id=$2 and active and kind in('bank','cash','ewallet') for update`, [input.accountId, org])
      if (!source.rowCount) {
        await c.query('rollback')
        return res.status(400).json({
          error: 'Rekening pembayaran tidak valid atau tidak aktif',
        })
      }
      let budgetCheck = null
      let budgetCart: Awaited<ReturnType<typeof validateBudgetCart>> = []
      if (input.budgetCategoryId) {
        if (input.budgetItems) budgetCart = await validateBudgetCart(c, org, input.budgetCategoryId, input.budgetItems, input.amount)
        else await assertBudgetItem(c, org, input.budgetCategoryId, input.budgetItemName)
        budgetCheck = await assertBudgetAvailable(c, org, input.budgetCategoryId, input.amount, undefined, req.auth!.role, input.overrideReason)
      }
      await c.query(`insert into accounts(organization_id,name,kind,currency,color) values($1,'Pengeluaran','clearing',$2,'#d89b50') on conflict(organization_id,name) do nothing`, [org, source.rows[0].currency])
      const counterpart = await c.query(`select id from accounts where organization_id=$1 and name='Pengeluaran' and kind='clearing' and active`, [org])
      const expenseCategory = await getExpenseCategory(c, org, input.category)
      const transaction = await c.query(`insert into transactions(organization_id,transaction_date,kind,status,description,category,expense_category_id,counterparty,budget_category_id,budget_item_name,payment_method,proof_url,created_by,posted_by,posted_at) values($1,$2::date,'expense','posted',$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,now()) returning id,status`, [org, input.transactionDate, input.description, expenseCategory.name, expenseCategory.id, input.counterparty || null, input.budgetCategoryId || null, input.budgetItemName || null, input.paymentMethod, input.proofUrl || null, req.auth!.userId])
      if (input.budgetCategoryId && budgetCart.length) await insertBudgetCart(c, transaction.rows[0].id, input.budgetCategoryId, budgetCart)
      await c.query(`insert into transaction_entries(transaction_id,account_id,amount) values($1,$2,$3),($1,$4,$5)`, [transaction.rows[0].id, source.rows[0].id, -input.amount, counterpart.rows[0].id, input.amount])
      await c.query(`insert into audit_logs(organization_id,actor_id,entity,entity_id,action,data) values($1,$2,'transaction',$3,'create_and_post_expense',$4)`, [
        org,
        req.auth!.userId,
        transaction.rows[0].id,
        JSON.stringify({
          amount: input.amount,
          accountId: input.accountId,
          budgetCategoryId: input.budgetCategoryId || null,
          budgetItemName: input.budgetItemName || null,
          budgetItems: budgetCart,
          budgetCheck,
          overrideReason: input.overrideReason || null,
          paymentMethod: input.paymentMethod,
          proofUrl: input.proofUrl || null,
        }),
      ])
      await c.query('commit')
      res.status(201).json(transaction.rows[0])
    } catch (e) {
      await c.query('rollback')
      throw e
    } finally {
      c.release()
    }
  } catch (e) {
    next(e)
  }
})

app.post('/api/deposits/:id/topup', requireAuth, requireFinance, async (req: AuthedRequest, res, next) => {
  try {
    const input = z
        .object({
          transactionDate: z.iso.date(),
          sourceAccountId: z.string().uuid(),
          amount: z.number().positive().max(1e15),
          proofUrl,
        })
        .parse(req.body),
      org = req.auth!.organizationId,
      c = await pool.connect()
    try {
      await c.query('begin')
      const deposit = await c.query(`select id,name,currency from accounts where id=$1 and organization_id=$2 and kind='deposit' and active for update`, [req.params.id, org]),
        source = await c.query(`select id,name,currency,opening_balance from accounts where id=$1 and organization_id=$2 and kind in('bank','cash','ewallet') and active for update`, [input.sourceAccountId, org])
      if (!deposit.rowCount || !source.rowCount) {
        await c.query('rollback')
        return res.status(400).json({ error: 'Rekening sumber atau akun deposit tidak valid' })
      }
      if (deposit.rows[0].currency !== source.rows[0].currency) {
        await c.query('rollback')
        return res.status(409).json({
          error: 'Mata uang rekening sumber dan deposit harus sama',
        })
      }
      const sourceEntries = await c.query(`select coalesce(sum(case when t.status='posted' then e.amount else 0 end),0)::numeric amount from transaction_entries e join transactions t on t.id=e.transaction_id where e.account_id=$1`, [source.rows[0].id]),
        sourceBalance = Number(source.rows[0].opening_balance) + Number(sourceEntries.rows[0].amount)
      if (sourceBalance < input.amount) {
        await c.query('rollback')
        return res.status(409).json({
          error: `Saldo ${source.rows[0].name} tidak mencukupi. Saldo tersedia Rp ${sourceBalance.toLocaleString('id-ID')}`,
        })
      }
      const transaction = await c.query(`insert into transactions(organization_id,transaction_date,kind,status,description,category,proof_url,created_by,posted_by,posted_at) values($1,$2::date,'deposit_topup','posted',$3,'Top-up deposit',$4,$5,$5,now()) returning id`, [org, input.transactionDate, `Top-up ${deposit.rows[0].name}`, input.proofUrl || null, req.auth!.userId])
      await c.query(`insert into transaction_entries(transaction_id,account_id,amount) values($1,$2,$3),($1,$4,$5)`, [transaction.rows[0].id, source.rows[0].id, -input.amount, deposit.rows[0].id, input.amount])
      await c.query(`insert into audit_logs(organization_id,actor_id,entity,entity_id,action,data) values($1,$2,'transaction',$3,'deposit_topup',$4)`, [
        org,
        req.auth!.userId,
        transaction.rows[0].id,
        JSON.stringify({
          depositAccountId: deposit.rows[0].id,
          sourceAccountId: source.rows[0].id,
          amount: input.amount,
          sourceBalanceBefore: sourceBalance,
        }),
      ])
      await c.query('commit')
      res.status(201).json({ id: transaction.rows[0].id })
    } catch (e) {
      await c.query('rollback')
      throw e
    } finally {
      c.release()
    }
  } catch (e) {
    next(e)
  }
})

app.post('/api/deposits/:id/usage', requireAuth, requireFinance, async (req: AuthedRequest, res, next) => {
  try {
    const input = z
        .object({
          transactionDate: z.iso.date(),
          amount: z.number().positive().max(1e15),
          description: z.string().trim().min(3).max(240),
          reference: z.string().trim().max(100).optional(),
          budgetCategoryId: z.string().uuid().optional(),
          overrideReason: z.string().trim().max(500).optional(),
        })
        .parse(req.body),
      org = req.auth!.organizationId,
      c = await pool.connect()
    try {
      await c.query('begin')
      const deposit = await c.query(`select id,name,currency,opening_balance from accounts where id=$1 and organization_id=$2 and kind='deposit' and active for update`, [req.params.id, org])
      if (!deposit.rowCount) {
        await c.query('rollback')
        return res.status(404).json({ error: 'Akun deposit tidak ditemukan' })
      }
      const entries = await c.query(`select coalesce(sum(case when t.status='posted' then e.amount else 0 end),0)::numeric amount from transaction_entries e join transactions t on t.id=e.transaction_id where e.account_id=$1`, [deposit.rows[0].id]),
        depositBalance = Number(deposit.rows[0].opening_balance) + Number(entries.rows[0].amount)
      if (depositBalance < input.amount) {
        await c.query('rollback')
        return res.status(409).json({ error: 'Saldo deposit tidak mencukupi' })
      }
      let budgetCheck = null
      if (input.budgetCategoryId) budgetCheck = await assertBudgetAvailable(c, org, input.budgetCategoryId, input.amount, undefined, req.auth!.role, input.overrideReason)
      await c.query(`insert into accounts(organization_id,name,kind,currency,color) values($1,'Pengeluaran','clearing',$2,'#d89b50') on conflict(organization_id,name) do nothing`, [org, deposit.rows[0].currency])
      const counterpart = await c.query(`select id from accounts where organization_id=$1 and name='Pengeluaran' and kind='clearing' and active`, [org])
      const transaction = await c.query(`insert into transactions(organization_id,transaction_date,kind,status,description,category,reference,budget_category_id,created_by,posted_by,posted_at) values($1,$2::date,'deposit_usage','posted',$3,'Pemakaian deposit',$4,$5,$6,$6,now()) returning id`, [org, input.transactionDate, input.description, input.reference || null, input.budgetCategoryId || null, req.auth!.userId])
      await c.query(`insert into transaction_entries(transaction_id,account_id,amount) values($1,$2,$3),($1,$4,$5)`, [transaction.rows[0].id, deposit.rows[0].id, -input.amount, counterpart.rows[0].id, input.amount])
      await c.query(`insert into audit_logs(organization_id,actor_id,entity,entity_id,action,data) values($1,$2,'transaction',$3,'deposit_usage',$4)`, [
        org,
        req.auth!.userId,
        transaction.rows[0].id,
        JSON.stringify({
          depositAccountId: deposit.rows[0].id,
          amount: input.amount,
          budgetCheck,
          overrideReason: input.overrideReason || null,
        }),
      ])
      await c.query('commit')
      res.status(201).json({ id: transaction.rows[0].id })
    } catch (e) {
      await c.query('rollback')
      throw e
    } finally {
      c.release()
    }
  } catch (e) {
    next(e)
  }
})

const billInput = z.object({
  vendor: z.string().trim().min(2).max(120),
  description: z.string().trim().min(2).max(200),
  dueDate: z.iso.date(),
  unitPrice: z.number().positive().max(1e15),
  quantity: z.number().positive().max(1e9),
  currency: z.enum(['IDR', 'USD']).default('IDR'),
  recurrence: z.enum(['monthly', 'yearly', 'once']),
  owner: z.string().trim().max(100).optional(),
  autoRenew: z.boolean().default(false),
  reminderDays: z
    .array(z.union([z.literal(1), z.literal(3), z.literal(7), z.literal(14), z.literal(30)]))
    .min(1)
    .max(5)
    .default([14, 7, 1]),
  paymentMethod,
})
app.post('/api/bills', requireAuth, requireFinance, async (req: AuthedRequest, res, next) => {
  try {
    const input = billInput.parse(req.body),
      amount = input.unitPrice * input.quantity,
      org = req.auth!.organizationId
    const bill = await pool.query(`insert into bills(organization_id,vendor,description,due_date,amount,unit_price,quantity,payment_method,currency,recurrence,owner_name,auto_renew,reminder_days) values($1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`, [org, input.vendor, input.description, input.dueDate, amount, input.unitPrice, input.quantity, input.paymentMethod, input.currency, input.recurrence, input.owner || null, input.autoRenew, input.reminderDays])
    await pool.query(`insert into audit_logs(organization_id,actor_id,entity,entity_id,action,data) values($1,$2,'bill',$3,'create',$4)`, [org, req.auth!.userId, bill.rows[0].id, JSON.stringify({ ...input, amount })])
    res.status(201).json({ id: bill.rows[0].id })
  } catch (e) {
    next(e)
  }
})
app.patch('/api/bills/:id', requireAuth, requireFinance, async (req: AuthedRequest, res, next) => {
  try {
    const input = billInput.parse(req.body),
      amount = input.unitPrice * input.quantity,
      org = req.auth!.organizationId
    const bill = await pool.query(`update bills set vendor=$1,description=$2,due_date=$3::date,amount=$4,unit_price=$5,quantity=$6,payment_method=$7,currency=$8,recurrence=$9,owner_name=$10,auto_renew=$11,reminder_days=$12,updated_at=now() where id=$13 and organization_id=$14 and status<>'paid' returning id`, [input.vendor, input.description, input.dueDate, amount, input.unitPrice, input.quantity, input.paymentMethod, input.currency, input.recurrence, input.owner || null, input.autoRenew, input.reminderDays, req.params.id, org])
    if (!bill.rowCount) return res.status(409).json({ error: 'Tagihan tidak ditemukan atau sudah dibayar' })
    await pool.query(`insert into audit_logs(organization_id,actor_id,entity,entity_id,action,data) values($1,$2,'bill',$3,'update',$4)`, [org, req.auth!.userId, req.params.id, JSON.stringify({ ...input, amount })])
    res.json({ ok: true })
  } catch (e) {
    next(e)
  }
})
app.delete('/api/bills/:id', requireAuth, requireFinance, async (req: AuthedRequest, res, next) => {
  try {
    const org = req.auth!.organizationId
    const bill = await pool.query(`update bills set status=case when status='paid' then status else 'cancelled' end,archived_at=case when status='paid' then now() else archived_at end,archived_by=case when status='paid' then $3 else archived_by end,updated_at=now() where id=$1 and organization_id=$2 and status<>'cancelled' and archived_at is null returning id,status,paid_transaction_id "paidTransactionId"`, [req.params.id, org, req.auth!.userId])
    if (!bill.rowCount) return res.status(404).json({ error: 'Tagihan tidak ditemukan atau sudah diremove' })
    const archived = bill.rows[0].status === 'paid'
    await pool.query(`insert into audit_logs(organization_id,actor_id,entity,entity_id,action,data) values($1,$2,'bill',$3,$4,$5)`, [org, req.auth!.userId, req.params.id, archived ? 'archive' : 'cancel', JSON.stringify({ paidTransactionId: bill.rows[0].paidTransactionId || null })])
    res.json({ ok: true, archived })
  } catch (e) {
    next(e)
  }
})

app.post('/api/bills/:id/pay', requireAuth, requireFinance, async (req: AuthedRequest, res, next) => {
  try {
    const input = z
        .object({
          transactionDate: z.iso.date(),
          accountId: z.string().uuid(),
          amount: z.number().positive().max(1e15),
          reference: z.string().trim().max(100).optional(),
          budgetCategoryId: z.string().uuid().optional(),
          overrideReason: z.string().trim().max(500).optional(),
        })
        .parse(req.body),
      org = req.auth!.organizationId,
      c = await pool.connect()
    try {
      await c.query('begin')
      const bill = await c.query(`select * from bills where id=$1 and organization_id=$2 for update`, [req.params.id, org])
      if (!bill.rowCount) {
        await c.query('rollback')
        return res.status(404).json({ error: 'Tagihan tidak ditemukan' })
      }
      if (bill.rows[0].status === 'paid') {
        await c.query('rollback')
        return res.status(409).json({ error: 'Tagihan sudah dibayar' })
      }
      const source = await c.query(`select id,currency from accounts where id=$1 and organization_id=$2 and kind in('bank','cash','ewallet') and active for update`, [input.accountId, org])
      if (!source.rowCount) {
        await c.query('rollback')
        return res.status(400).json({ error: 'Rekening pembayaran tidak valid' })
      }
      if (source.rows[0].currency !== bill.rows[0].currency) {
        await c.query('rollback')
        return res.status(409).json({ error: 'Mata uang rekening dan tagihan harus sama' })
      }
      if (input.reference) {
        const duplicate = await c.query('select id from transactions where organization_id=$1 and lower(reference)=lower($2) limit 1', [org, input.reference])
        if (duplicate.rowCount) {
          await c.query('rollback')
          return res.status(409).json({ error: 'Referensi pembayaran sudah pernah digunakan' })
        }
      }
      let budgetCheck = null
      if (input.budgetCategoryId) budgetCheck = await assertBudgetAvailable(c, org, input.budgetCategoryId, input.amount, undefined, req.auth!.role, input.overrideReason)
      await c.query(`insert into accounts(organization_id,name,kind,currency,color) values($1,'Pengeluaran','clearing',$2,'#d89b50') on conflict(organization_id,name) do nothing`, [org, source.rows[0].currency])
      const counterpart = await c.query(`select id from accounts where organization_id=$1 and name='Pengeluaran' and kind='clearing' and active`, [org])
      const budgetExpenseCategory = input.budgetCategoryId ? await c.query(`select ec.id,ec.name from budget_categories bc left join expense_categories ec on ec.id=bc.expense_category_id where bc.id=$1`, [input.budgetCategoryId]) : null
      const category = budgetExpenseCategory?.rows[0]?.name ? budgetExpenseCategory.rows[0] : await getFallbackExpenseCategory(c, org, 'Utilities & Langganan')
      const transaction = await c.query(`insert into transactions(organization_id,transaction_date,kind,status,description,category,expense_category_id,reference,counterparty,budget_category_id,created_by,posted_by,posted_at) values($1,$2::date,'expense','posted',$3,$4,$5,$6,$7,$8,$9,$9,now()) returning id`, [org, input.transactionDate, `${bill.rows[0].vendor} — ${bill.rows[0].description}`.slice(0, 240), category.name, category.id, input.reference || null, bill.rows[0].vendor, input.budgetCategoryId || null, req.auth!.userId])
      await c.query(`insert into transaction_entries(transaction_id,account_id,amount) values($1,$2,$3),($1,$4,$5)`, [transaction.rows[0].id, source.rows[0].id, -input.amount, counterpart.rows[0].id, input.amount])
      await c.query(`update bills set status='paid',paid_transaction_id=$1,paid_at=now(),paid_by=$2 where id=$3`, [transaction.rows[0].id, req.auth!.userId, bill.rows[0].id])
      let nextBillId = null
      if (bill.rows[0].recurrence !== 'once') {
        const next = await c.query(`insert into bills(organization_id,vendor,description,due_date,amount,unit_price,quantity,payment_method,currency,recurrence,owner_name,auto_renew,reminder_days) values($1,$2,$3,($4::date+case when $5='monthly' then interval '1 month' else interval '1 year' end)::date,$6,$7,$8,$9,$10,$5,$11,$12,$13) returning id`, [org, bill.rows[0].vendor, bill.rows[0].description, bill.rows[0].due_date, bill.rows[0].recurrence, bill.rows[0].amount, bill.rows[0].unit_price || bill.rows[0].amount, bill.rows[0].quantity || 1, bill.rows[0].payment_method, bill.rows[0].currency, bill.rows[0].owner_name, bill.rows[0].auto_renew, bill.rows[0].reminder_days])
        nextBillId = next.rows[0].id
      }
      await c.query(`insert into audit_logs(organization_id,actor_id,entity,entity_id,action,data) values($1,$2,'bill',$3,'pay',$4)`, [
        org,
        req.auth!.userId,
        bill.rows[0].id,
        JSON.stringify({
          transactionId: transaction.rows[0].id,
          amount: input.amount,
          accountId: input.accountId,
          nextBillId,
          budgetCheck,
          overrideReason: input.overrideReason || null,
        }),
      ])
      await c.query('commit')
      res.status(201).json({ transactionId: transaction.rows[0].id, nextBillId })
    } catch (e) {
      await c.query('rollback')
      throw e
    } finally {
      c.release()
    }
  } catch (e) {
    next(e)
  }
})

app.post('/api/transactions/:id/post', requireAuth, requireFinance, async (req: AuthedRequest, res, next) => {
  try {
    const { overrideReason } = z.object({ overrideReason: z.string().trim().max(500).optional() }).parse(req.body || {}),
      c = await pool.connect()
    try {
      await c.query('begin')
      const transaction = await c.query(`select id,status,kind,budget_category_id "budgetCategoryId" from transactions where id=$1 and organization_id=$2 for update`, [req.params.id, req.auth!.organizationId])
      if (!transaction.rowCount) {
        await c.query('rollback')
        return res.status(404).json({ error: 'Transaksi tidak ditemukan' })
      }
      if (!['draft', 'pending'].includes(transaction.rows[0].status)) {
        await c.query('rollback')
        return res.status(409).json({
          error: 'Transaksi sudah diposting atau tidak dapat diubah',
        })
      }
      const balance = await c.query('select count(*)::int count,coalesce(sum(amount),0)::numeric balance from transaction_entries where transaction_id=$1', [req.params.id])
      if (balance.rows[0].count < 2 || Number(balance.rows[0].balance) !== 0) {
        await c.query('rollback')
        return res.status(409).json({ error: 'Jurnal transaksi tidak seimbang' })
      }
      let budgetCheck = null
      if (transaction.rows[0].kind === 'expense' && transaction.rows[0].budgetCategoryId) {
        const amount = await c.query(`select coalesce(sum(abs(e.amount)),0)::numeric amount from transaction_entries e join accounts a on a.id=e.account_id where e.transaction_id=$1 and a.kind in('bank','cash','ewallet')`, [req.params.id])
        budgetCheck = await assertBudgetAvailable(c, req.auth!.organizationId, transaction.rows[0].budgetCategoryId, Number(amount.rows[0].amount), undefined, req.auth!.role, overrideReason)
      }
      await c.query(`update transactions set status='posted',posted_by=$1,posted_at=now() where id=$2`, [req.auth!.userId, req.params.id])
      await c.query(`insert into audit_logs(organization_id,actor_id,entity,entity_id,action,data) values($1,$2,'transaction',$3,'post',$4)`, [
        req.auth!.organizationId,
        req.auth!.userId,
        req.params.id,
        JSON.stringify({
          previousStatus: transaction.rows[0].status,
          budgetCheck,
          overrideReason: overrideReason || null,
        }),
      ])
      await c.query('commit')
      res.json({ ok: true })
    } catch (e) {
      await c.query('rollback')
      throw e
    } finally {
      c.release()
    }
  } catch (e) {
    next(e)
  }
})

app.post('/api/transactions/:id/reverse', requireAuth, requireFinance, async (req: AuthedRequest, res, next) => {
  try {
    const input = z
        .object({
          transactionDate: z.iso.date(),
          reason: z.string().trim().min(5).max(500),
        })
        .parse(req.body),
      org = req.auth!.organizationId,
      c = await pool.connect()
    try {
      await c.query('begin')
      const original = await c.query(`select id,description,category,budget_category_id,purchase_request_id from transactions where id=$1 and organization_id=$2 and status='posted' and reversal_of is null for update`, [req.params.id, org])
      if (!original.rowCount) {
        await c.query('rollback')
        return res.status(409).json({
          error: 'Hanya transaksi posted yang belum dikoreksi yang dapat direversal',
        })
      }
      const existing = await c.query('select id from transactions where reversal_of=$1', [original.rows[0].id])
      if (existing.rowCount) {
        await c.query('rollback')
        return res.status(409).json({ error: 'Transaksi ini sudah memiliki reversal' })
      }
      if (original.rows[0].purchase_request_id) {
        const purchase = await c.query('select id,status from purchase_requests where id=$1 for update', [original.rows[0].purchase_request_id])
        if (purchase.rows[0]?.status === 'received') {
          await c.query('rollback')
          return res.status(409).json({
            error: 'Pembayaran barang yang sudah diterima tidak dapat direversal sebelum penerimaan ditinjau',
          })
        }
      }
      const reversal = await c.query(`insert into transactions(organization_id,transaction_date,kind,status,description,category,budget_category_id,created_by,posted_by,posted_at,reversal_of) values($1,$2::date,'reversal','posted',$3,$4,$5,$6,$6,now(),$7) returning id`, [org, input.transactionDate, `Koreksi: ${original.rows[0].description}`.slice(0, 240), original.rows[0].category, original.rows[0].budget_category_id, req.auth!.userId, original.rows[0].id])
      await c.query(`insert into transaction_entries(transaction_id,account_id,amount) select $1,account_id,-amount from transaction_entries where transaction_id=$2`, [reversal.rows[0].id, original.rows[0].id])
      if (original.rows[0].purchase_request_id) {
        await c.query(`update purchase_requests set status='approved',payment_transaction_id=null,paid_amount=null,paid_at=null,paid_by=null,payment_reference=null,proof_reference=null where id=$1`, [original.rows[0].purchase_request_id])
        await c.query(`insert into purchase_events(purchase_request_id,from_status,to_status,actor_id,note) values($1,'purchased','approved',$2,$3)`, [original.rows[0].purchase_request_id, req.auth!.userId, `Pembayaran direversal: ${input.reason}`])
      }
      await c.query(`insert into audit_logs(organization_id,actor_id,entity,entity_id,action,data) values($1,$2,'transaction',$3,'reverse',$4)`, [
        org,
        req.auth!.userId,
        original.rows[0].id,
        JSON.stringify({
          reversalId: reversal.rows[0].id,
          reason: input.reason,
          purchaseRequestId: original.rows[0].purchase_request_id || null,
        }),
      ])
      await c.query('commit')
      res.status(201).json({ id: reversal.rows[0].id })
    } catch (e) {
      await c.query('rollback')
      throw e
    } finally {
      c.release()
    }
  } catch (e) {
    next(e)
  }
})

app.patch('/api/transactions/:id', requireAuth, requireFinance, async (req: AuthedRequest, res, next) => {
  const org = req.auth!.organizationId
  const c = await pool.connect()
  try {
    await c.query('begin')
    const original = await c.query(`select * from transactions where id=$1 and organization_id=$2 and status='posted' and reversal_of is null and kind in('income','expense') for update`, [req.params.id, org])
    if (!original.rowCount) {
      await c.query('rollback')
      return res.status(409).json({ error: 'Transaksi tidak ditemukan atau tidak dapat diedit' })
    }
    const old = original.rows[0]
    const linkedBill = await c.query('select 1 from bills where paid_transaction_id=$1', [old.id])
    if (linkedBill.rowCount) {
      await c.query('rollback')
      return res.status(409).json({ error: 'Pembayaran tagihan harus dikoreksi dari modul Tagihan & Renewal' })
    }
    const linkedPurchase = old.purchase_request_id ? await c.query('select id,status from purchase_requests where id=$1 and organization_id=$2 for update', [old.purchase_request_id, org]) : null
    if (old.purchase_request_id && !linkedPurchase?.rowCount) {
      await c.query('rollback')
      return res.status(409).json({ error: 'Pengajuan belanja yang terkait tidak ditemukan' })
    }
    const existing = await c.query('select 1 from transactions where reversal_of=$1 or replaces_transaction_id=$1', [old.id])
    if (existing.rowCount) {
      await c.query('rollback')
      return res.status(409).json({ error: 'Transaksi ini sudah pernah dikoreksi' })
    }
    const input = old.kind === 'income' ? incomeInput.parse(req.body) : expenseInput.parse(req.body)
    const reversal = await c.query(`insert into transactions(organization_id,transaction_date,kind,status,description,category,budget_category_id,created_by,posted_by,posted_at,reversal_of) values($1,$2::date,'reversal','posted',$3,$4,$5,$6,$6,now(),$7) returning id`, [org, old.transaction_date, `Edit: ${old.description}`.slice(0, 240), old.category, old.budget_category_id, req.auth!.userId, old.id])
    await c.query(`insert into transaction_entries(transaction_id,account_id,amount) select $1,account_id,-amount from transaction_entries where transaction_id=$2`, [reversal.rows[0].id, old.id])

    let replacement
    if (old.kind === 'income') {
      const income = input as z.infer<typeof incomeInput>
      const source = incomeSources[income.sourceType]
      const destination = await c.query(`select id,currency from accounts where id=$1 and organization_id=$2 and active and kind in('bank','cash','ewallet') for update`, [income.accountId, org])
      if (!destination.rowCount) throw Object.assign(new Error('Rekening penerima tidak valid atau tidak aktif'), { statusCode: 400 })
      await c.query(`insert into accounts(organization_id,name,kind,currency,color) values($1,$2,'clearing',$3,$4) on conflict(organization_id,name) do nothing`, [org, source.counterpart, destination.rows[0].currency, income.sourceType === 'owner_capital' ? '#607d73' : income.sourceType === 'company_loan' ? '#776a91' : '#225c55'])
      const counterpart = await c.query(`select id from accounts where organization_id=$1 and name=$2 and kind='clearing' and active`, [org, source.counterpart])
      replacement = await c.query(`insert into transactions(organization_id,transaction_date,kind,status,description,category,counterparty,income_source,payment_method,proof_url,created_by,posted_by,posted_at,replaces_transaction_id) values($1,$2::date,'income','posted',$3,$4,$5,$6,$7,$8,$9,$9,now(),$10) returning id`, [org, income.transactionDate, income.description, source.category, income.counterparty || null, income.sourceType, income.paymentMethod, income.proofUrl || null, req.auth!.userId, old.id])
      await c.query(`insert into transaction_entries(transaction_id,account_id,amount) values($1,$2,$3),($1,$4,$5)`, [replacement.rows[0].id, destination.rows[0].id, income.amount, counterpart.rows[0].id, -income.amount])
    } else {
      const expense = input as z.infer<typeof expenseInput>
      const source = await c.query(`select id,currency from accounts where id=$1 and organization_id=$2 and active and kind in('bank','cash','ewallet') for update`, [expense.accountId, org])
      if (!source.rowCount) throw Object.assign(new Error('Rekening pembayaran tidak valid atau tidak aktif'), { statusCode: 400 })
      let budgetCheck = null
      let budgetCart: Awaited<ReturnType<typeof validateBudgetCart>> = []
      if (expense.budgetCategoryId) {
        if (expense.budgetItems) budgetCart = await validateBudgetCart(c, org, expense.budgetCategoryId, expense.budgetItems, expense.amount)
        else await assertBudgetItem(c, org, expense.budgetCategoryId, expense.budgetItemName)
        budgetCheck = await assertBudgetAvailable(c, org, expense.budgetCategoryId, expense.amount, undefined, req.auth!.role, expense.overrideReason)
      }
      await c.query(`insert into accounts(organization_id,name,kind,currency,color) values($1,'Pengeluaran','clearing',$2,'#d89b50') on conflict(organization_id,name) do nothing`, [org, source.rows[0].currency])
      const counterpart = await c.query(`select id from accounts where organization_id=$1 and name='Pengeluaran' and kind='clearing' and active`, [org])
      const expenseCategory = await getExpenseCategory(c, org, expense.category)
      replacement = await c.query(`insert into transactions(organization_id,transaction_date,kind,status,description,category,expense_category_id,counterparty,budget_category_id,budget_item_name,purchase_request_id,payment_method,proof_url,created_by,posted_by,posted_at,replaces_transaction_id) values($1,$2::date,'expense','posted',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12,now(),$13) returning id`, [org, expense.transactionDate, expense.description, expenseCategory.name, expenseCategory.id, expense.counterparty || null, expense.budgetCategoryId || null, expense.budgetItemName || null, old.purchase_request_id, expense.paymentMethod, expense.proofUrl || null, req.auth!.userId, old.id])
      if (expense.budgetCategoryId && budgetCart.length) await insertBudgetCart(c, replacement.rows[0].id, expense.budgetCategoryId, budgetCart)
      await c.query(`insert into transaction_entries(transaction_id,account_id,amount) values($1,$2,$3),($1,$4,$5)`, [replacement.rows[0].id, source.rows[0].id, -expense.amount, counterpart.rows[0].id, expense.amount])
      if (old.purchase_request_id) {
        await c.query(`update purchase_requests set payment_transaction_id=$1,paid_amount=$2,paid_by=$3,payment_reference=$4,proof_reference=$5 where id=$6`, [replacement.rows[0].id, expense.amount, req.auth!.userId, expense.paymentMethod, expense.proofUrl || null, old.purchase_request_id])
        await c.query(`insert into purchase_events(purchase_request_id,from_status,to_status,actor_id,note) values($1,$2,$2,$3,$4)`, [old.purchase_request_id, linkedPurchase!.rows[0].status, req.auth!.userId, 'Data pembayaran diedit dari halaman Transaksi'])
      }
      void budgetCheck
    }
    await c.query(`insert into audit_logs(organization_id,actor_id,entity,entity_id,action,data) values($1,$2,'transaction',$3,'edit_replace',$4)`, [org, req.auth!.userId, old.id, JSON.stringify({ reversalId: reversal.rows[0].id, replacementId: replacement.rows[0].id, previousDescription: old.description })])
    await c.query('commit')
    res.json({ id: replacement.rows[0].id })
  } catch (e) {
    await c.query('rollback')
    next(e)
  } finally {
    c.release()
  }
})

app.post('/api/purchase-requests', requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const input = z
      .object({
        department: z.string().min(2).max(80),
        title: z.string().min(2).max(120),
        purpose: z.string().min(5).max(500),
        urgency: z.enum(['normal', 'urgent']),
        vendor: z.string().max(120).optional(),
        quantity: z.number().positive().max(999),
        unitPrice: z.number().nonnegative().max(1e12),
        budgetCategoryId: z.string().uuid().optional(),
      })
      .parse(req.body)
    const c = await pool.connect()
    try {
      await c.query('begin')
      if (input.budgetCategoryId) {
        const category = await c.query(`select 1 from budget_categories bc join budget_periods bp on bp.id=bc.budget_period_id where bc.id=$1 and bp.organization_id=$2 and bp.status<>'closed' and bc.archived_at is null`, [input.budgetCategoryId, req.auth!.organizationId])
        if (!category.rowCount) {
          await c.query('rollback')
          return res.status(400).json({
            error: 'Pos anggaran tidak valid atau periodenya sudah ditutup',
          })
        }
      }
      const year = new Date().getFullYear()
      const seq = await c.query(`insert into purchase_request_counters(organization_id,request_year,last_value) values($1,$2,1) on conflict(organization_id,request_year) do update set last_value=purchase_request_counters.last_value+1 returning last_value`, [req.auth!.organizationId, year])
      const no = `PR-${year}-${String(seq.rows[0].last_value).padStart(4, '0')}`
      const p = await c.query(`insert into purchase_requests(organization_id,request_number,requested_by,department,title,purpose,urgency,vendor,estimated_total,budget_category_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id,request_number "requestNumber"`, [req.auth!.organizationId, no, req.auth!.userId, input.department, input.title, input.purpose, input.urgency, input.vendor || null, input.quantity * input.unitPrice, input.budgetCategoryId || null])
      await c.query('insert into purchase_request_items(purchase_request_id,item_name,quantity,unit_price) values($1,$2,$3,$4)', [p.rows[0].id, input.title, input.quantity, input.unitPrice])
      await c.query(`insert into purchase_events(purchase_request_id,to_status,actor_id,note) values($1,'submitted',$2,'Pengajuan dibuat')`, [p.rows[0].id, req.auth!.userId])
      await c.query('commit')
      res.status(201).json(p.rows[0])
    } catch (e) {
      await c.query('rollback')
      throw e
    } finally {
      c.release()
    }
  } catch (e) {
    next(e)
  }
})

app.post('/api/purchase-requests/:id/transition', requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const { status, note, overrideReason } = z
        .object({
          status: z.enum(['approved', 'received', 'rejected']),
          note: z.string().trim().max(500).optional(),
          overrideReason: z.string().trim().max(500).optional(),
        })
        .parse(req.body),
      org = req.auth!.organizationId,
      c = await pool.connect()
    try {
      await c.query('begin')
      const p = await c.query('select * from purchase_requests where id=$1 and organization_id=$2 for update', [req.params.id, org])
      if (!p.rowCount) {
        await c.query('rollback')
        return res.status(404).json({ error: 'Pengajuan tidak ditemukan' })
      }
      const old = p.rows[0].status
      const approval = old === 'submitted' && ['approved', 'rejected'].includes(status) && ['owner', 'admin', 'finance'].includes(req.auth!.role)
      const receiving = old === 'purchased' && status === 'received' && (p.rows[0].requested_by === req.auth!.userId || ['owner', 'admin'].includes(req.auth!.role))
      if (!approval && !receiving) {
        await c.query('rollback')
        return res.status(403).json({
          error: 'Anda tidak berwenang melakukan perubahan status ini',
        })
      }
      let budgetCheck = null
      if (status === 'approved' && p.rows[0].budget_category_id) budgetCheck = await assertBudgetAvailable(c, org, p.rows[0].budget_category_id, Number(p.rows[0].estimated_total), p.rows[0].id, req.auth!.role, overrideReason)
      await c.query('update purchase_requests set status=$1 where id=$2', [status, p.rows[0].id])
      await c.query('insert into purchase_events(purchase_request_id,from_status,to_status,actor_id,note) values($1,$2,$3,$4,$5)', [p.rows[0].id, old, status, req.auth!.userId, note || overrideReason || null])
      await c.query(`insert into audit_logs(organization_id,actor_id,entity,entity_id,action,data) values($1,$2,'purchase_request',$3,$4,$5)`, [
        org,
        req.auth!.userId,
        p.rows[0].id,
        status,
        JSON.stringify({
          from: old,
          to: status,
          budgetCheck,
          overrideReason: overrideReason || null,
        }),
      ])
      await c.query('commit')
      res.json({ ok: true })
    } catch (e) {
      await c.query('rollback')
      throw e
    } finally {
      c.release()
    }
  } catch (e) {
    next(e)
  }
})

app.post('/api/purchase-requests/:id/pay', requireAuth, requireFinance, async (req: AuthedRequest, res, next) => {
  try {
    const input = z
        .object({
          transactionDate: z.iso.date(),
          accountId: z.string().uuid(),
          amount: z.number().positive().max(1e15),
          paymentMethod,
          proofReference: z.url().max(240).optional(),
          overrideReason: z.string().trim().max(500).optional(),
        })
        .parse(req.body),
      org = req.auth!.organizationId,
      c = await pool.connect()
    try {
      await c.query('begin')
      const p = await c.query('select * from purchase_requests where id=$1 and organization_id=$2 for update', [req.params.id, org])
      if (!p.rowCount) {
        await c.query('rollback')
        return res.status(404).json({ error: 'Pengajuan tidak ditemukan' })
      }
      if (p.rows[0].status !== 'approved' || p.rows[0].payment_transaction_id) {
        await c.query('rollback')
        return res.status(409).json({
          error: 'Pengajuan harus berstatus disetujui dan belum pernah dibayar',
        })
      }
      const source = await c.query(`select id,currency from accounts where id=$1 and organization_id=$2 and active and kind in('bank','cash','ewallet') for update`, [input.accountId, org])
      if (!source.rowCount) {
        await c.query('rollback')
        return res.status(400).json({
          error: 'Rekening pembayaran tidak valid atau tidak aktif',
        })
      }
      let budgetCheck = null
      if (p.rows[0].budget_category_id) budgetCheck = await assertBudgetAvailable(c, org, p.rows[0].budget_category_id, input.amount, p.rows[0].id, req.auth!.role, input.overrideReason)
      await c.query(`insert into accounts(organization_id,name,kind,currency,color) values($1,'Pengeluaran','clearing',$2,'#d89b50') on conflict(organization_id,name) do nothing`, [org, source.rows[0].currency])
      const counterpart = await c.query(`select id from accounts where organization_id=$1 and name='Pengeluaran' and kind='clearing' and active`, [org])
      const budgetExpenseCategory = p.rows[0].budget_category_id ? await c.query(`select ec.id,ec.name from budget_categories bc left join expense_categories ec on ec.id=bc.expense_category_id where bc.id=$1`, [p.rows[0].budget_category_id]) : null
      const category = budgetExpenseCategory?.rows[0]?.name ? budgetExpenseCategory.rows[0] : await getFallbackExpenseCategory(c, org, 'Lain-Lain')
      const transaction = await c.query(`insert into transactions(organization_id,transaction_date,kind,status,description,category,expense_category_id,counterparty,budget_category_id,purchase_request_id,payment_method,proof_url,created_by,posted_by,posted_at) values($1,$2::date,'expense','posted',$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,now()) returning id`, [org, input.transactionDate, p.rows[0].title, category.name, category.id, p.rows[0].vendor || null, p.rows[0].budget_category_id, p.rows[0].id, input.paymentMethod, input.proofReference || null, req.auth!.userId])
      await c.query(`insert into transaction_entries(transaction_id,account_id,amount) values($1,$2,$3),($1,$4,$5)`, [transaction.rows[0].id, source.rows[0].id, -input.amount, counterpart.rows[0].id, input.amount])
      await c.query(`update purchase_requests set status='purchased',payment_transaction_id=$1,paid_amount=$2,paid_at=now(),paid_by=$3,payment_reference=$4,proof_reference=$5 where id=$6`, [transaction.rows[0].id, input.amount, req.auth!.userId, input.paymentMethod, input.proofReference || null, p.rows[0].id])
      await c.query(`insert into purchase_events(purchase_request_id,from_status,to_status,actor_id,note) values($1,'approved','purchased',$2,$3)`, [p.rows[0].id, req.auth!.userId, input.proofReference ? 'Pembayaran dicatat dengan bukti' : 'Pembayaran dicatat'])
      await c.query(`insert into audit_logs(organization_id,actor_id,entity,entity_id,action,data) values($1,$2,'purchase_request',$3,'pay',$4)`, [
        org,
        req.auth!.userId,
        p.rows[0].id,
        JSON.stringify({
          transactionId: transaction.rows[0].id,
          amount: input.amount,
          accountId: input.accountId,
          paymentMethod: input.paymentMethod,
          proofReference: input.proofReference || null,
          budgetCheck,
          overrideReason: input.overrideReason || null,
        }),
      ])
      await c.query('commit')
      res.status(201).json({ transactionId: transaction.rows[0].id })
    } catch (e) {
      await c.query('rollback')
      throw e
    } finally {
      c.release()
    }
  } catch (e) {
    next(e)
  }
})

const monthInput = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)
const budgetCategoryInput = z.object({
  name: z.string().trim().min(2).max(80),
  expenseCategory: z.string().trim().min(2).max(80),
  details: z.array(z.string().trim().min(2).max(80)).max(30).default([]),
  budgetModel: z.enum(['fixed', 'multi_item']).default('fixed'),
  lineItems: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        name: z.string().trim().min(2).max(80),
        quantity: z.number().int().positive().max(1e6),
        unitPrice: z.number().nonnegative().max(1e15),
      }),
    )
    .max(30)
    .default([]),
  categoryType: z.enum(['fixed', 'variable', 'emergency', 'investment']),
  plannedAmount: z.number().nonnegative().max(1e15),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
}).superRefine((input, context) => {
  if (input.budgetModel === 'multi_item' && !input.lineItems.length) context.addIssue({ code: 'custom', path: ['lineItems'], message: 'Tambahkan minimal satu item RAB' })
  const names = input.lineItems.map((item) => item.name.trim().toLocaleLowerCase())
  if (new Set(names).size !== names.length) context.addIssue({ code: 'custom', path: ['lineItems'], message: 'Nama item RAB tidak boleh sama' })
  const total = input.lineItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
  if (!Number.isFinite(total) || total > 1e15) context.addIssue({ code: 'custom', path: ['lineItems'], message: 'Total item RAB terlalu besar' })
})

function normalizedBudgetCategory(input: z.infer<typeof budgetCategoryInput>) {
  const lineItems = input.budgetModel === 'multi_item' ? input.lineItems.map((item) => ({ ...item, id: item.id || randomUUID() })) : []
  return {
    ...input,
    details: lineItems.map((item) => item.name),
    lineItems,
    plannedAmount: input.budgetModel === 'multi_item' ? lineItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0) : input.plannedAmount,
  }
}

app.get('/api/reports', requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const month = monthInput.parse(req.query.month),
      org = req.auth!.organizationId,
      start = `${month}-01`
    const [summary, categories, cashflow] = await Promise.all([
      pool.query(
        `select coalesce(sum(case when t.kind='income' then te.amount when t.kind='reversal' and original.kind='income' then te.amount else 0 end),0)::numeric income,coalesce(sum(case when t.kind in('expense','deposit_usage') then -te.amount when t.kind='reversal' and original.kind in('expense','deposit_usage') then -te.amount else 0 end),0)::numeric expense,(select coalesce(sum(a.opening_balance+coalesce((select sum(case when tx.status='posted' then e.amount else 0 end) from transaction_entries e join transactions tx on tx.id=e.transaction_id where e.account_id=a.id),0)),0) from accounts a where a.organization_id=$1 and a.kind='deposit' and a.active)::numeric "depositBalance" from transactions t join transaction_entries te on te.transaction_id=t.id join accounts a on a.id=te.account_id left join transactions original on original.id=t.reversal_of where t.organization_id=$1 and t.status='posted' and a.kind in('bank','cash','ewallet','deposit') and date_trunc('month',t.transaction_date)=$2::date`,
        [org, start],
      ),
      pool.query(`select coalesce(ec.name,max(t.category)) name,coalesce(ec.color,'#8b9692') color,coalesce(sum(case when t.kind in('expense','deposit_usage') then -te.amount when t.kind='reversal' and original.kind in('expense','deposit_usage') then -te.amount else 0 end),0)::numeric value from transactions t join transaction_entries te on te.transaction_id=t.id join accounts a on a.id=te.account_id left join transactions original on original.id=t.reversal_of left join expense_categories ec on ec.id=coalesce(t.expense_category_id,original.expense_category_id) where t.organization_id=$1 and t.status='posted' and a.kind in('bank','cash','ewallet','deposit') and date_trunc('month',t.transaction_date)=$2::date and (t.kind in('expense','deposit_usage') or (t.kind='reversal' and original.kind in('expense','deposit_usage'))) group by ec.id,ec.name,ec.color having sum(-te.amount)<>0 order by abs(sum(te.amount)) desc`, [org, start]),
      pool.query(`with report_months(report_month) as(select generate_series(($2::date-interval '5 months')::date,$2::date,interval '1 month')::date) select to_char(m.report_month,'YYYY-MM') as "month",coalesce(sum(case when t.kind='income' then te.amount when t.kind='reversal' and original.kind='income' then te.amount else 0 end),0)::numeric income,coalesce(sum(case when t.kind in('expense','deposit_usage') then -te.amount when t.kind='reversal' and original.kind in('expense','deposit_usage') then -te.amount else 0 end),0)::numeric expense from report_months m left join transactions t on t.organization_id=$1 and t.status='posted' and date_trunc('month',t.transaction_date)=m.report_month left join transactions original on original.id=t.reversal_of left join transaction_entries te on te.transaction_id=t.id left join accounts a on a.id=te.account_id and a.kind in('bank','cash','ewallet','deposit') where a.id is not null or t.id is null group by m.report_month order by m.report_month`, [
        org,
        start,
      ]),
    ])
    res.json({
      summary: summary.rows[0],
      categories: categories.rows,
      cashflow: cashflow.rows,
    })
  } catch (e) {
    next(e)
  }
})

app.get('/api/budgets', requireAuth, async (req: AuthedRequest, res, next) => {
  try {
    const month = monthInput.parse(req.query.month)
    const period = await pool.query(`select id,to_char(month,'YYYY-MM') as "month",status,coalesce(notes,'') as notes from budget_periods where organization_id=$1 and month=$2::date`, [req.auth!.organizationId, `${month}-01`])
    if (!period.rowCount) return res.json({ budget: null, categories: [] })
    const categories = await pool.query(
      `select bc.id,bc.name,bc.category_type "categoryType",bc.budget_model "budgetModel",bc.planned_amount::numeric "plannedAmount",bc.color,coalesce(ec.name,bc.expense_category,'Lain-Lain') "expenseCategory",coalesce(ec.id::text,'') "expenseCategoryId",coalesce(ec.active,false) "expenseCategoryActive",bc.details,coalesce((select jsonb_agg(item || jsonb_build_object('purchasedQuantity',coalesce(usage.quantity,0),'remainingQuantity',greatest(0,(item->>'quantity')::int-coalesce(usage.quantity,0))) order by ordinal) from jsonb_array_elements(bc.line_items) with ordinality source(item,ordinal) left join lateral(select sum(tbi.quantity)::int quantity from transaction_budget_items tbi join transactions tx on tx.id=tbi.transaction_id where tbi.budget_category_id=bc.id and tbi.budget_item_id=(item->>'id')::uuid and tx.status='posted' and tx.kind='expense' and not exists(select 1 from transactions r where r.reversal_of=tx.id and r.status='posted')) usage on true),'[]'::jsonb) "lineItems",
    coalesce((select sum(-te.amount) from transactions t join transaction_entries te on te.transaction_id=t.id join accounts a on a.id=te.account_id where t.organization_id=$1 and t.status='posted' and t.budget_category_id=bc.id and a.kind in('bank','cash','ewallet')),0)::numeric actual,
    coalesce((select sum(pr.estimated_total) from purchase_requests pr where pr.organization_id=$1 and pr.budget_category_id=bc.id and pr.status='submitted'),0)::numeric "pendingAmount",
    coalesce((select sum(pr.estimated_total) from purchase_requests pr where pr.organization_id=$1 and pr.budget_category_id=bc.id and pr.status='approved'),0)::numeric "committedAmount",
    (not exists(
      select 1 from transactions t where t.budget_category_id=bc.id and t.kind<>'reversal' and t.status in('draft','pending','posted')
      and not exists(select 1 from transactions r where r.reversal_of=t.id and r.status='posted')
    ) and not exists(select 1 from purchase_requests pr where pr.budget_category_id=bc.id and pr.status in('submitted','approved','purchased'))) "canDelete"
    from budget_categories bc join budget_periods bp on bp.id=bc.budget_period_id left join expense_categories ec on ec.id=bc.expense_category_id where bc.budget_period_id=$2 and bc.archived_at is null order by bc.created_at,bc.name`,
      [req.auth!.organizationId, period.rows[0].id],
    )
    res.json({ budget: period.rows[0], categories: categories.rows })
  } catch (e) {
    next(e)
  }
})

app.post('/api/budgets', requireAuth, requireFinance, async (req: AuthedRequest, res, next) => {
  try {
    const input = z
      .object({
        month: monthInput,
        notes: z.string().max(500).optional(),
        categories: z.array(budgetCategoryInput).max(30).optional(),
      })
      .parse(req.body)
    const defaults = input.categories?.length
      ? input.categories.map(normalizedBudgetCategory)
      : [
          {
            name: 'Server & cloud',
            expenseCategory: 'Utilities & Langganan' as const,
            details: [],
            budgetModel: 'fixed' as const,
            lineItems: [],
            categoryType: 'fixed' as const,
            plannedAmount: 0,
            color: '#2f7168',
          },
          {
            name: 'Kebutuhan kantor',
            expenseCategory: 'Kebersihan & Perlengkapan' as const,
            details: [],
            budgetModel: 'fixed' as const,
            lineItems: [],
            categoryType: 'variable' as const,
            plannedAmount: 0,
            color: '#d89b50',
          },
          {
            name: 'Iklan digital',
            expenseCategory: 'Lain-Lain' as const,
            details: [],
            budgetModel: 'fixed' as const,
            lineItems: [],
            categoryType: 'variable' as const,
            plannedAmount: 0,
            color: '#4f78a5',
          },
          {
            name: 'Software',
            expenseCategory: 'Utilities & Langganan' as const,
            details: [],
            budgetModel: 'fixed' as const,
            lineItems: [],
            categoryType: 'fixed' as const,
            plannedAmount: 0,
            color: '#776a91',
          },
          {
            name: 'Dana darurat',
            expenseCategory: 'Lain-Lain' as const,
            details: [],
            budgetModel: 'fixed' as const,
            lineItems: [],
            categoryType: 'emergency' as const,
            plannedAmount: 0,
            color: '#b85d55',
          },
        ]
    const c = await pool.connect()
    try {
      await c.query('begin')
      const created = await c.query(`insert into budget_periods(organization_id,month,notes,created_by) values($1,$2::date,$3,$4) returning id,to_char(month,'YYYY-MM') as "month",status`, [req.auth!.organizationId, `${input.month}-01`, input.notes || null, req.auth!.userId])
      for (const category of defaults) {
        const expenseCategory = await getExpenseCategory(c, req.auth!.organizationId, category.expenseCategory)
        await c.query('insert into budget_categories(budget_period_id,name,expense_category,expense_category_id,details,budget_model,line_items,category_type,planned_amount,color) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [created.rows[0].id, category.name, expenseCategory.name, expenseCategory.id, category.details, category.budgetModel, JSON.stringify(category.lineItems), category.categoryType, category.plannedAmount, category.color])
      }
      await c.query(`insert into audit_logs(organization_id,actor_id,entity,entity_id,action,data) values($1,$2,'budget_period',$3,'create',$4)`, [req.auth!.organizationId, req.auth!.userId, created.rows[0].id, JSON.stringify({ month: input.month })])
      await c.query('commit')
      res.status(201).json(created.rows[0])
    } catch (e) {
      await c.query('rollback')
      if ((e as { code?: string }).code === '23505') return res.status(409).json({ error: 'RAB untuk bulan ini sudah tersedia' })
      throw e
    } finally {
      c.release()
    }
  } catch (e) {
    next(e)
  }
})

app.post('/api/budgets/copy-previous', requireAuth, requireFinance, async (req: AuthedRequest, res, next) => {
  try {
    const { month } = z.object({ month: monthInput }).parse(req.body)
    const c = await pool.connect()
    try {
      await c.query('begin')
      const previous = await c.query(`select id from budget_periods where organization_id=$1 and month=($2::date-interval '1 month')::date`, [req.auth!.organizationId, `${month}-01`])
      if (!previous.rowCount) {
        await c.query('rollback')
        return res.status(404).json({ error: 'RAB bulan sebelumnya belum tersedia' })
      }
      const created = await c.query(`insert into budget_periods(organization_id,month,notes,created_by) values($1,$2::date,'Disalin dari bulan sebelumnya',$3) returning id`, [req.auth!.organizationId, `${month}-01`, req.auth!.userId])
      await c.query(`insert into budget_categories(budget_period_id,name,expense_category,expense_category_id,details,budget_model,line_items,category_type,planned_amount,color) select $1,name,expense_category,expense_category_id,details,budget_model,line_items,category_type,planned_amount,color from budget_categories where budget_period_id=$2 and archived_at is null`, [created.rows[0].id, previous.rows[0].id])
      await c.query(`insert into audit_logs(organization_id,actor_id,entity,entity_id,action,data) values($1,$2,'budget_period',$3,'copy_previous',$4)`, [req.auth!.organizationId, req.auth!.userId, created.rows[0].id, JSON.stringify({ month })])
      await c.query('commit')
      res.status(201).json({ id: created.rows[0].id })
    } catch (e) {
      await c.query('rollback')
      if ((e as { code?: string }).code === '23505') return res.status(409).json({ error: 'RAB untuk bulan ini sudah tersedia' })
      throw e
    } finally {
      c.release()
    }
  } catch (e) {
    next(e)
  }
})

app.post('/api/budgets/:id/categories', requireAuth, requireFinance, async (req: AuthedRequest, res, next) => {
  try {
    const input = normalizedBudgetCategory(budgetCategoryInput.parse(req.body))
    const period = await pool.query(`select id,status from budget_periods where id=$1 and organization_id=$2`, [req.params.id, req.auth!.organizationId])
    if (!period.rowCount) return res.status(404).json({ error: 'RAB tidak ditemukan' })
    if (period.rows[0].status === 'closed') return res.status(409).json({ error: 'RAB yang sudah ditutup tidak dapat diubah' })
    const expenseCategory = await getExpenseCategory(pool, req.auth!.organizationId, input.expenseCategory)
    const category = await pool.query(`insert into budget_categories(budget_period_id,name,expense_category,expense_category_id,details,budget_model,line_items,category_type,planned_amount,color) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`, [period.rows[0].id, input.name, expenseCategory.name, expenseCategory.id, input.details, input.budgetModel, JSON.stringify(input.lineItems), input.categoryType, input.plannedAmount, input.color])
    await pool.query(`insert into audit_logs(organization_id,actor_id,entity,entity_id,action,data) values($1,$2,'budget_category',$3,'create',$4)`, [req.auth!.organizationId, req.auth!.userId, category.rows[0].id, JSON.stringify(input)])
    res.status(201).json({ id: category.rows[0].id })
  } catch (e) {
    if ((e as { code?: string }).code === '23505') return res.status(409).json({ error: 'Nama pos anggaran sudah digunakan' })
    next(e)
  }
})

app.patch('/api/budget-categories/:id', requireAuth, requireFinance, async (req: AuthedRequest, res, next) => {
  try {
    const input = normalizedBudgetCategory(budgetCategoryInput.parse(req.body))
    const expenseCategory = await getExpenseCategory(pool, req.auth!.organizationId, input.expenseCategory)
    const usedItems = await pool.query(`select tbi.budget_item_id::text id,max(tbi.item_name) name,sum(tbi.quantity)::int quantity from transaction_budget_items tbi join transactions t on t.id=tbi.transaction_id where tbi.budget_category_id=$1 and t.status='posted' and t.kind='expense' and not exists(select 1 from transactions r where r.reversal_of=t.id and r.status='posted') group by tbi.budget_item_id`, [req.params.id])
    const nextItems = new Map(input.lineItems.map((item) => [item.id, item]))
    for (const used of usedItems.rows) {
      const next = nextItems.get(used.id)
      if (!next) return res.status(409).json({ error: `${used.name} sudah pernah dibeli dan tidak dapat dihapus dari RAB` })
      if (next.quantity < Number(used.quantity)) return res.status(409).json({ error: `Qty rencana ${used.name} tidak boleh lebih kecil dari ${used.quantity} yang sudah dibeli` })
    }
    const category = await pool.query(`update budget_categories bc set name=$1,expense_category=$2,expense_category_id=$3,details=$4,budget_model=$5,line_items=$6,category_type=$7,planned_amount=$8,color=$9,updated_at=now() from budget_periods bp where bc.id=$10 and bp.id=bc.budget_period_id and bp.organization_id=$11 and bp.status<>'closed' and bc.archived_at is null returning bc.id`, [input.name, expenseCategory.name, expenseCategory.id, input.details, input.budgetModel, JSON.stringify(input.lineItems), input.categoryType, input.plannedAmount, input.color, req.params.id, req.auth!.organizationId])
    if (!category.rowCount)
      return res.status(404).json({
        error: 'Pos anggaran tidak ditemukan atau RAB sudah ditutup',
      })
    await pool.query(`insert into audit_logs(organization_id,actor_id,entity,entity_id,action,data) values($1,$2,'budget_category',$3,'update',$4)`, [req.auth!.organizationId, req.auth!.userId, category.rows[0].id, JSON.stringify(input)])
    res.json({ ok: true })
  } catch (e) {
    if ((e as { code?: string }).code === '23505') return res.status(409).json({ error: 'Nama pos anggaran sudah digunakan' })
    next(e)
  }
})

app.delete('/api/budget-categories/:id', requireAuth, requireFinance, async (req: AuthedRequest, res, next) => {
  const c = await pool.connect()
  try {
    await c.query('begin')
    const category = await c.query(
      `select bc.id,bc.name,bc.category_type "categoryType",bc.budget_model "budgetModel",bc.planned_amount::numeric "plannedAmount",bc.expense_category "expenseCategory",bc.details,bc.line_items "lineItems",bc.color
       from budget_categories bc join budget_periods bp on bp.id=bc.budget_period_id
       where bc.id=$1 and bp.organization_id=$2 and bp.status<>'closed' and bc.archived_at is null
       for update of bc`,
      [req.params.id, req.auth!.organizationId],
    )
    if (!category.rowCount) {
      await c.query('rollback')
      return res.status(404).json({ error: 'Pos anggaran tidak ditemukan atau RAB sudah ditutup' })
    }
    const usage = await c.query(
      `select
         (select count(*)::int from transactions where budget_category_id=$1) "transactionCount",
         (select count(*)::int from transactions t where t.budget_category_id=$1 and t.kind<>'reversal' and t.status in('draft','pending','posted') and not exists(select 1 from transactions r where r.reversal_of=t.id and r.status='posted')) "activeTransactionCount",
         (select count(*)::int from purchase_requests where budget_category_id=$1) "requestCount",
         (select count(*)::int from purchase_requests where budget_category_id=$1 and status in('submitted','approved','purchased')) "activeRequestCount"`,
      [req.params.id],
    )
    if (usage.rows[0].activeTransactionCount > 0 || usage.rows[0].activeRequestCount > 0) {
      await c.query('rollback')
      return res.status(409).json({ error: 'Pos masih memiliki transaksi efektif atau pengajuan aktif dan belum dapat diremove.' })
    }
    const archived = usage.rows[0].transactionCount > 0 || usage.rows[0].requestCount > 0
    if (archived) await c.query('update budget_categories set archived_at=now(),archived_by=$2,updated_at=now() where id=$1', [req.params.id, req.auth!.userId])
    else await c.query('delete from budget_categories where id=$1', [req.params.id])
    await c.query(`insert into audit_logs(organization_id,actor_id,entity,entity_id,action,data) values($1,$2,'budget_category',$3,$4,$5)`, [req.auth!.organizationId, req.auth!.userId, req.params.id, archived ? 'archive' : 'delete', JSON.stringify({ ...category.rows[0], usage: usage.rows[0] })])
    await c.query('commit')
    res.json({ ok: true, archived })
  } catch (e) {
    await c.query('rollback')
    next(e)
  } finally {
    c.release()
  }
})

app.post('/api/budgets/:id/status', requireAuth, requireUserAdmin, async (req: AuthedRequest, res, next) => {
  try {
    const { status } = z.object({ status: z.enum(['active', 'closed']) }).parse(req.body),
      org = req.auth!.organizationId,
      c = await pool.connect()
    try {
      await c.query('begin')
      const period = await c.query('select id,status from budget_periods where id=$1 and organization_id=$2 for update', [req.params.id, org])
      if (!period.rowCount) {
        await c.query('rollback')
        return res.status(404).json({ error: 'RAB tidak ditemukan' })
      }
      if (status === 'closed') {
        const open = await c.query(`select count(*)::int count from purchase_requests pr join budget_categories bc on bc.id=pr.budget_category_id where bc.budget_period_id=$1 and pr.status in('submitted','approved','purchased')`, [period.rows[0].id])
        if (open.rows[0].count > 0) {
          await c.query('rollback')
          return res.status(409).json({
            error: 'Selesaikan atau tolak semua pengajuan berjalan sebelum menutup RAB',
          })
        }
      }
      await c.query('update budget_periods set status=$1,updated_at=now() where id=$2', [status, period.rows[0].id])
      await c.query(`insert into audit_logs(organization_id,actor_id,entity,entity_id,action,data) values($1,$2,'budget_period',$3,$4,$5)`, [org, req.auth!.userId, period.rows[0].id, status === 'closed' ? 'close' : 'reopen', JSON.stringify({ previousStatus: period.rows[0].status })])
      await c.query('commit')
      res.json({ ok: true })
    } catch (e) {
      await c.query('rollback')
      throw e
    } finally {
      c.release()
    }
  } catch (e) {
    next(e)
  }
})

app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found' }))
const clientDist = path.join(import.meta.dirname, '../dist')
app.use(
  '/assets',
  express.static(path.join(clientDist, 'assets'), {
    maxAge: '1y',
    immutable: true,
    etag: true,
    index: false,
  }),
)
app.use(
  express.static(clientDist, {
    maxAge: 0,
    etag: true,
    index: false,
    setHeaders(res, file) {
      if (file.endsWith('.html')) res.setHeader('Cache-Control', 'no-store, max-age=0')
    },
  }),
)
app.use((_req, res) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0')
  res.sendFile(path.join(clientDist, 'index.html'))
})
app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  void next
  if (error instanceof z.ZodError)
    return res.status(400).json({
      error: 'Data tidak valid',
      details: error.issues.map((i) => i.path.join('.')),
    })
  const known = error as {
    statusCode?: number
    message?: string
    code?: string
  }
  if (known.statusCode) return res.status(known.statusCode).json({ error: known.message })
  if (known.code === '55000') return res.status(409).json({ error: 'Periode keuangan sudah ditutup dan tidak dapat diubah' })
  console.error(error)
  res.status(500).json({ error: 'Terjadi kesalahan pada server' })
})

await migrate()
await pool.query('delete from sessions where expires_at<=now()')
const server = app.listen(port, '0.0.0.0', () => console.log(`Emisell Finance listening on ${port}`))
let shuttingDown = false
async function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`${signal} received, closing Emisell Finance`)
  const timer = setTimeout(() => process.exit(1), 10_000)
  timer.unref()
  server.close(async (error) => {
    try {
      if (error) console.error(error)
      await pool.end()
      process.exit(error ? 1 : 0)
    } catch (closeError) {
      console.error(closeError)
      process.exit(1)
    }
  })
}
process.once('SIGTERM', () => void shutdown('SIGTERM'))
process.once('SIGINT', () => void shutdown('SIGINT'))
