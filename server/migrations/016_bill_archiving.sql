alter table bills
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references users(id);

create index if not exists bills_active_org_due_idx
  on bills(organization_id,due_date)
  where archived_at is null and status <> 'cancelled';
