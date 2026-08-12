alter table organizations
  add column legal_name varchar(160),
  add column tax_id varchar(40),
  add column finance_email varchar(254),
  add column address varchar(500),
  add column timezone varchar(60) not null default 'Asia/Jakarta';

create table organization_settings(
  organization_id uuid primary key references organizations(id) on delete cascade,
  default_account_id uuid references accounts(id) on delete set null,
  transaction_prefix varchar(12) not null default 'TRX',
  purchase_prefix varchar(12) not null default 'PR',
  minimum_cash_balance numeric(20,2) not null default 0 check(minimum_cash_balance >= 0),
  bill_reminder_days integer not null default 7 check(bill_reminder_days between 1 and 60),
  notify_bills boolean not null default true,
  notify_low_deposit boolean not null default true,
  notify_purchase_approval boolean not null default true,
  notify_reconciliation boolean not null default true,
  owner_approval_threshold numeric(20,2) not null default 10000000 check(owner_approval_threshold >= 0),
  session_hours integer not null default 12 check(session_hours between 1 and 168),
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into organization_settings(organization_id)
select id from organizations
on conflict(organization_id) do nothing;

create table data_backups(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  created_by uuid references users(id) on delete set null,
  snapshot jsonb not null,
  item_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index data_backups_org_created_idx on data_backups(organization_id,created_at desc);

create or replace function apply_purchase_request_prefix() returns trigger language plpgsql as $$
declare configured_prefix varchar(12);
begin
  select purchase_prefix into configured_prefix from organization_settings where organization_id=new.organization_id;
  if configured_prefix is not null and new.request_number like 'PR-%' then
    new.request_number := configured_prefix || substring(new.request_number from 3);
  end if;
  return new;
end $$;

create trigger purchase_request_prefix_before_insert
before insert on purchase_requests for each row execute function apply_purchase_request_prefix();
