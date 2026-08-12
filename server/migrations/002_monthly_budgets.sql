create table budget_periods(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  month date not null check(month = date_trunc('month', month)::date),
  status varchar(12) not null default 'active' check(status in('draft','active','closed')),
  notes varchar(500),
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id, month)
);

create table budget_categories(
  id uuid primary key default gen_random_uuid(),
  budget_period_id uuid not null references budget_periods(id) on delete cascade,
  name varchar(80) not null,
  category_type varchar(16) not null default 'variable' check(category_type in('fixed','variable','emergency','investment')),
  planned_amount numeric(20,2) not null default 0 check(planned_amount >= 0),
  color char(7) not null default '#2f7168' check(color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(budget_period_id, name)
);

alter table purchase_requests
  add column budget_category_id uuid references budget_categories(id) on delete set null;

create index budget_periods_org_month_idx on budget_periods(organization_id, month);
create index budget_categories_period_idx on budget_categories(budget_period_id);
create index purchase_requests_budget_category_idx on purchase_requests(budget_category_id);
