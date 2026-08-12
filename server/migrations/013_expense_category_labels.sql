create table if not exists expense_categories(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name varchar(80) not null,
  color char(7) not null default '#4f78a5' check(color ~ '^#[0-9A-Fa-f]{6}$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists expense_categories_org_name_unique on expense_categories(organization_id,lower(name));

insert into expense_categories(organization_id,name,color)
select o.id,v.name,v.color from organizations o cross join(values
  ('Utilities & Langganan','#4f78a5'),('Konsumsi & Pantry','#d89b50'),('Kebersihan & Perlengkapan','#6f9f72'),
  ('Kegiatan','#b98953'),('Personalia','#8a6fa5'),('Lain-Lain','#8b9692')
) v(name,color) on conflict do nothing;

insert into expense_categories(organization_id,name,color)
select distinct t.organization_id,t.category,'#607d73' from transactions t where nullif(trim(t.category),'') is not null on conflict do nothing;
insert into expense_categories(organization_id,name,color)
select distinct bp.organization_id,bc.expense_category,'#607d73' from budget_categories bc join budget_periods bp on bp.id=bc.budget_period_id where nullif(trim(bc.expense_category),'') is not null on conflict do nothing;

alter table transactions add column if not exists expense_category_id uuid references expense_categories(id) on delete restrict;
alter table budget_categories add column if not exists expense_category_id uuid references expense_categories(id) on delete restrict;

alter table transactions disable trigger transactions_immutable;
update transactions t set expense_category_id=ec.id from expense_categories ec where ec.organization_id=t.organization_id and lower(ec.name)=lower(t.category) and t.expense_category_id is null;
alter table transactions enable trigger transactions_immutable;
update budget_categories bc set expense_category_id=ec.id from budget_periods bp,expense_categories ec where bp.id=bc.budget_period_id and ec.organization_id=bp.organization_id and lower(ec.name)=lower(bc.expense_category) and bc.expense_category_id is null;

create index if not exists transactions_expense_category_idx on transactions(expense_category_id) where expense_category_id is not null;
create index if not exists budget_categories_expense_category_idx on budget_categories(expense_category_id) where expense_category_id is not null;
