alter table budget_categories
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references users(id);

alter table budget_categories
  drop constraint if exists budget_categories_budget_period_id_name_key;

create unique index if not exists budget_categories_period_active_name_unique
  on budget_categories(budget_period_id,name)
  where archived_at is null;

create index if not exists budget_categories_active_period_idx
  on budget_categories(budget_period_id)
  where archived_at is null;
