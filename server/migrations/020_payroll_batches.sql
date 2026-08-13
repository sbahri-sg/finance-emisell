create table payroll_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  payroll_month date not null,
  employee_count integer not null check(employee_count > 0 and employee_count <= 10000),
  net_pay numeric(20,2) not null check(net_pay > 0),
  status varchar(20) not null default 'ready' check(status in ('ready','paid')),
  budget_category_id uuid not null references budget_categories(id),
  payment_transaction_id uuid references transactions(id),
  payment_reference varchar(100),
  proof_url varchar(500),
  notes varchar(500),
  created_by uuid not null references users(id),
  paid_by uuid references users(id),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,payroll_month)
);

create index payroll_batches_organization_month_idx on payroll_batches(organization_id,payroll_month desc);
create index payroll_batches_budget_status_idx on payroll_batches(budget_category_id,status);
