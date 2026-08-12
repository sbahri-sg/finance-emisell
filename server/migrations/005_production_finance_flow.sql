alter table transactions
  add column budget_category_id uuid references budget_categories(id) on delete restrict,
  add column purchase_request_id uuid unique references purchase_requests(id) on delete restrict,
  add column reversal_of uuid unique references transactions(id) on delete restrict;

alter table purchase_requests
  add column payment_transaction_id uuid unique references transactions(id) on delete restrict,
  add column paid_amount numeric(20,2) check(paid_amount > 0),
  add column paid_at timestamptz,
  add column paid_by uuid references users(id),
  add column payment_reference varchar(100),
  add column proof_reference varchar(240);

create table purchase_request_counters(
  organization_id uuid not null references organizations(id) on delete cascade,
  request_year integer not null check(request_year between 2020 and 2200),
  last_value integer not null default 0 check(last_value >= 0),
  primary key(organization_id, request_year)
);

create table account_reconciliations(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete restrict,
  statement_date date not null,
  ledger_balance numeric(20,2) not null,
  statement_balance numeric(20,2) not null,
  difference numeric(20,2) generated always as (statement_balance-ledger_balance) stored,
  note varchar(500),
  reconciled_by uuid not null references users(id),
  created_at timestamptz not null default now()
);

create index transactions_budget_category_idx on transactions(budget_category_id) where budget_category_id is not null;
create index account_reconciliations_account_date_idx on account_reconciliations(account_id, statement_date desc, created_at desc);

create or replace function validate_posted_transaction_balance() returns trigger language plpgsql as $$
declare target_id uuid; target_status varchar(12); entry_count integer; entry_total numeric(20,2);
begin
  if tg_table_name='transactions' then target_id := case when tg_op='DELETE' then old.id else new.id end;
  else target_id := case when tg_op='DELETE' then old.transaction_id else new.transaction_id end; end if;
  select status into target_status from transactions where id=target_id;
  if target_status in ('posted','reversed') then
    select count(*),coalesce(sum(amount),0) into entry_count,entry_total from transaction_entries where transaction_id=target_id;
    if entry_count < 2 or entry_total <> 0 then raise exception 'Posted transaction % must contain a balanced journal',target_id using errcode='23514'; end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;

create constraint trigger transaction_balance_from_entries
after insert or update or delete on transaction_entries
deferrable initially deferred for each row execute function validate_posted_transaction_balance();

create constraint trigger transaction_balance_from_status
after insert or update of status on transactions
deferrable initially deferred for each row execute function validate_posted_transaction_balance();

create or replace function prevent_closed_finance_period() returns trigger language plpgsql as $$
declare target_org uuid; target_date date;
begin
  target_org := case when tg_op='DELETE' then old.organization_id else new.organization_id end;
  target_date := case when tg_op='DELETE' then old.transaction_date else new.transaction_date end;
  if exists(select 1 from budget_periods where organization_id=target_org and month=date_trunc('month',target_date)::date and status='closed') then
    raise exception 'Financial period is closed' using errcode='55000';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;

create trigger transactions_closed_period_guard
before insert or update or delete on transactions
for each row execute function prevent_closed_finance_period();
