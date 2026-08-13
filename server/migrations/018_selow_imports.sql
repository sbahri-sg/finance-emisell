create table deposit_import_entries(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  deposit_account_id uuid not null references accounts(id),
  transaction_id uuid not null references transactions(id),
  source varchar(30) not null default 'selow',
  fingerprint char(64) not null,
  occurred_at timestamp not null,
  raw_note varchar(240),
  raw_amount numeric(20,2) not null,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  unique(organization_id,deposit_account_id,source,fingerprint)
);

create index deposit_import_entries_transaction_idx on deposit_import_entries(transaction_id);
create index deposit_import_entries_account_date_idx on deposit_import_entries(deposit_account_id,occurred_at desc);

comment on table deposit_import_entries is
  'Metadata and idempotency keys for transactions imported from prepaid-card providers.';
