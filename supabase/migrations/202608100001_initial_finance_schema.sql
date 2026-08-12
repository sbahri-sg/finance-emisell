-- Finora finance schema
-- Run with Supabase CLI or in a fresh PostgreSQL/Supabase project.

create extension if not exists pgcrypto;

create type public.app_role as enum ('owner', 'finance', 'staff', 'auditor');
create type public.account_kind as enum ('bank', 'cash', 'credit_card', 'ewallet', 'deposit', 'clearing');
create type public.transaction_status as enum ('draft', 'pending', 'posted', 'voided');
create type public.transaction_kind as enum ('income', 'expense', 'transfer', 'deposit_topup', 'deposit_usage', 'credit_purchase', 'credit_payment', 'adjustment', 'reversal');
create type public.bill_status as enum ('draft', 'upcoming', 'due', 'paid', 'overdue', 'cancelled');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  legal_name text,
  base_currency char(3) not null default 'IDR' check (base_currency ~ '^[A-Z]{3}$'),
  timezone text not null default 'Asia/Jakarta',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (char_length(full_name) between 2 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.app_role not null default 'staff',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare display_name text;
begin
  display_name := coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), nullif(split_part(new.email, '@', 1), ''));
  if display_name is null or char_length(display_name) < 2 then display_name := 'New User'; end if;
  insert into public.profiles (id, full_name)
  values (new.id, left(display_name, 100))
  on conflict (id) do nothing;
  return new;
end; $$;

create trigger auth_user_created after insert on auth.users
for each row execute function public.handle_new_auth_user();

insert into public.profiles(id,full_name)
select id,
  left(case
    when char_length(coalesce(nullif(trim(raw_user_meta_data->>'full_name'),''),nullif(split_part(email,'@',1),''),'')) >= 2
    then coalesce(nullif(trim(raw_user_meta_data->>'full_name'),''),nullif(split_part(email,'@',1),''))
    else 'New User'
  end,100)
from auth.users
on conflict(id) do nothing;

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  name text not null check (char_length(name) between 2 and 100),
  institution text,
  kind public.account_kind not null,
  currency char(3) not null default 'IDR' check (currency ~ '^[A-Z]{3}$'),
  account_number_last4 char(4),
  opening_balance numeric(20,2) not null default 0,
  credit_limit numeric(20,2) check (credit_limit is null or credit_limit >= 0),
  low_balance_threshold numeric(20,2) check (low_balance_threshold is null or low_balance_threshold >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  category_type text not null check (category_type in ('income', 'expense', 'asset', 'liability')),
  active boolean not null default true,
  unique (organization_id, name)
);

create table public.vendors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 120),
  email text check (email is null or email ~* '^[^@]+@[^@]+\.[^@]+$'),
  phone text,
  bank_name text,
  bank_account_last4 char(4),
  bank_account_fingerprint text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  transaction_number bigint generated always as identity,
  transaction_date date not null,
  kind public.transaction_kind not null,
  status public.transaction_status not null default 'draft',
  description text not null check (char_length(description) between 2 and 240),
  reference text,
  vendor_id uuid references public.vendors(id) on delete set null,
  idempotency_key uuid not null default gen_random_uuid(),
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  posted_by uuid references public.profiles(id) on delete restrict,
  posted_at timestamptz,
  reversal_of uuid unique references public.transactions(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, idempotency_key),
  unique (organization_id, transaction_number),
  check ((status = 'posted' and posted_at is not null and posted_by is not null) or status <> 'posted')
);

create table public.transaction_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  transaction_id uuid not null references public.transactions(id) on delete restrict,
  account_id uuid not null references public.accounts(id) on delete restrict,
  category_id uuid references public.categories(id) on delete restrict,
  amount numeric(20,2) not null check (amount <> 0),
  base_amount numeric(20,2) not null check (base_amount <> 0),
  exchange_rate numeric(20,8) not null default 1 check (exchange_rate > 0),
  memo text check (memo is null or char_length(memo) <= 240),
  created_at timestamptz not null default now()
);

create table public.bills (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  vendor_id uuid references public.vendors(id) on delete set null,
  name text not null check (char_length(name) between 2 and 120),
  amount numeric(20,2) not null check (amount > 0),
  currency char(3) not null default 'IDR',
  due_date date not null,
  recurrence text not null default 'once' check (recurrence in ('once', 'monthly', 'quarterly', 'yearly')),
  auto_renew boolean not null default false,
  reminder_days smallint[] not null default '{14,7,1}',
  status public.bill_status not null default 'upcoming',
  owner_id uuid references public.profiles(id) on delete set null,
  paid_transaction_id uuid references public.transactions(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (reminder_days <@ array[1,3,7,14,30]::smallint[])
);

create table public.reconciliations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  account_id uuid not null references public.accounts(id) on delete restrict,
  statement_date date not null,
  statement_balance numeric(20,2) not null,
  ledger_balance numeric(20,2) not null,
  difference numeric(20,2) generated always as (statement_balance - ledger_balance) stored,
  notes text,
  reconciled_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  reconciled_at timestamptz not null default now(),
  unique (account_id, statement_date)
);

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  transaction_id uuid references public.transactions(id) on delete cascade,
  bill_id uuid references public.bills(id) on delete cascade,
  storage_path text not null check (storage_path !~ '(^/|\.\.)'),
  original_name text not null,
  mime_type text not null check (mime_type in ('application/pdf','image/jpeg','image/png','image/webp')),
  size_bytes integer not null check (size_bytes between 1 and 10485760),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  uploaded_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  check ((transaction_id is not null)::int + (bill_id is not null)::int = 1)
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  actor_id uuid references public.profiles(id) on delete set null,
  table_name text not null,
  record_id uuid not null,
  action text not null check (action in ('INSERT','UPDATE','DELETE','POST','VOID','REVERSE')),
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

create index transactions_org_date_idx on public.transactions (organization_id, transaction_date desc);
create index transactions_org_status_idx on public.transactions (organization_id, status);
create index entries_transaction_idx on public.transaction_entries (transaction_id);
create index entries_account_idx on public.transaction_entries (account_id, created_at);
create index bills_org_due_idx on public.bills (organization_id, due_date) where status not in ('paid','cancelled');
create index audit_org_created_idx on public.audit_logs (organization_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path=public as $$
begin new.updated_at=now(); return new; end; $$;
create trigger organizations_set_updated_at before update on public.organizations for each row execute function public.set_updated_at();
create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger accounts_set_updated_at before update on public.accounts for each row execute function public.set_updated_at();
create trigger vendors_set_updated_at before update on public.vendors for each row execute function public.set_updated_at();
create trigger transactions_set_updated_at before update on public.transactions for each row execute function public.set_updated_at();
create trigger bills_set_updated_at before update on public.bills for each row execute function public.set_updated_at();

create or replace function public.is_org_member(target_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.organization_members
    where organization_id = target_org and user_id = auth.uid() and active
  );
$$;

create or replace function public.has_org_role(target_org uuid, allowed public.app_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.organization_members
    where organization_id = target_org and user_id = auth.uid() and active and role = any(allowed)
  );
$$;

revoke all on function public.is_org_member(uuid) from public;
revoke all on function public.has_org_role(uuid, public.app_role[]) from public;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.has_org_role(uuid, public.app_role[]) to authenticated;

create or replace function public.bootstrap_organization(org_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare new_org uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if char_length(trim(org_name)) not between 2 and 120 then raise exception 'Organization name must contain 2-120 characters'; end if;
  if exists (select 1 from public.organization_members where user_id=auth.uid() and active) then
    raise exception 'User already belongs to an organization' using errcode='23505';
  end if;
  insert into public.organizations(name,legal_name) values(trim(org_name),trim(org_name)) returning id into new_org;
  insert into public.organization_members(organization_id,user_id,role) values(new_org,auth.uid(),'owner');
  return new_org;
end; $$;
revoke all on function public.bootstrap_organization(text) from public;
grant execute on function public.bootstrap_organization(text) to authenticated;

create or replace function public.validate_entry_scope()
returns trigger language plpgsql set search_path = public as $$
declare tx_org uuid; acc_org uuid; cat_org uuid;
begin
  select organization_id into tx_org from public.transactions where id = new.transaction_id;
  select organization_id into acc_org from public.accounts where id = new.account_id;
  if new.category_id is not null then select organization_id into cat_org from public.categories where id = new.category_id; end if;
  if tx_org is null or acc_org is null or tx_org <> new.organization_id or acc_org <> new.organization_id or (new.category_id is not null and cat_org <> new.organization_id) then
    raise exception 'Cross-organization ledger entry is forbidden' using errcode = '23514';
  end if;
  return new;
end; $$;

create trigger validate_entry_scope_before_write before insert or update on public.transaction_entries
for each row execute function public.validate_entry_scope();

create or replace function public.protect_posted_transaction()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.status in ('posted','voided') then
    raise exception 'Posted or voided transactions are immutable; create a reversal' using errcode = '55000';
  end if;
  return new;
end; $$;

create trigger protect_posted_transaction_before_change before update or delete on public.transactions
for each row execute function public.protect_posted_transaction();

create or replace function public.protect_posted_entries()
returns trigger language plpgsql set search_path = public as $$
declare tx_status public.transaction_status;
begin
  select status into tx_status from public.transactions where id = coalesce(new.transaction_id, old.transaction_id);
  if tx_status in ('posted','voided') then
    raise exception 'Entries of a posted or voided transaction are immutable' using errcode = '55000';
  end if;
  return coalesce(new, old);
end; $$;

create trigger protect_posted_entries_before_change before update or delete on public.transaction_entries
for each row execute function public.protect_posted_entries();

create or replace function public.audit_row_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare org_id uuid; rec_id uuid;
begin
  org_id := coalesce(new.organization_id, old.organization_id);
  rec_id := coalesce(new.id, old.id);
  insert into public.audit_logs (organization_id, actor_id, table_name, record_id, action, old_data, new_data)
  values (org_id, auth.uid(), tg_table_name, rec_id, tg_op, case when tg_op <> 'INSERT' then to_jsonb(old) end, case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end; $$;

create trigger audit_accounts after insert or update or delete on public.accounts for each row execute function public.audit_row_change();
create trigger audit_transactions after insert or update or delete on public.transactions for each row execute function public.audit_row_change();
create trigger audit_bills after insert or update or delete on public.bills for each row execute function public.audit_row_change();
create trigger audit_vendors after insert or update or delete on public.vendors for each row execute function public.audit_row_change();

create or replace function public.post_transaction(target_transaction uuid)
returns public.transactions language plpgsql security definer set search_path = public as $$
declare tx public.transactions; entry_count integer; balance numeric(20,2);
begin
  select * into tx from public.transactions where id = target_transaction for update;
  if tx.id is null then raise exception 'Transaction not found' using errcode = 'P0002'; end if;
  if not public.has_org_role(tx.organization_id, array['owner','finance']::public.app_role[]) then raise exception 'Insufficient permission' using errcode = '42501'; end if;
  if tx.status not in ('draft','pending') then raise exception 'Only draft or pending transactions can be posted'; end if;
  select count(*), coalesce(sum(base_amount),0) into entry_count, balance from public.transaction_entries where transaction_id = tx.id;
  if entry_count < 2 then raise exception 'A transaction requires at least two ledger entries'; end if;
  if balance <> 0 then raise exception 'Ledger entries are not balanced: %', balance; end if;
  update public.transactions set status='posted', posted_at=now(), posted_by=auth.uid(), updated_at=now() where id=tx.id returning * into tx;
  return tx;
end; $$;

revoke all on function public.post_transaction(uuid) from public;
grant execute on function public.post_transaction(uuid) to authenticated;

create or replace function public.reverse_transaction(target_transaction uuid, reason text)
returns public.transactions language plpgsql security definer set search_path = public as $$
declare original public.transactions; reversal_id uuid; result public.transactions;
begin
  select * into original from public.transactions where id=target_transaction and status='posted' for update;
  if original.id is null then raise exception 'Posted transaction not found' using errcode='P0002'; end if;
  if not public.has_org_role(original.organization_id,array['owner','finance']::public.app_role[]) then raise exception 'Insufficient permission' using errcode='42501'; end if;
  if char_length(trim(reason)) < 5 then raise exception 'A reversal reason is required'; end if;

  insert into public.transactions(organization_id,transaction_date,kind,status,description,reference,created_by,reversal_of)
  values(original.organization_id,current_date,'reversal','draft','Reversal: '||left(trim(reason),200),'REV-'||original.transaction_number,auth.uid(),original.id)
  returning id into reversal_id;

  insert into public.transaction_entries(organization_id,transaction_id,account_id,category_id,amount,base_amount,exchange_rate,memo)
  select organization_id,reversal_id,account_id,category_id,-amount,-base_amount,exchange_rate,'Reversal of '||original.transaction_number
  from public.transaction_entries where transaction_id=original.id;

  select public.post_transaction(reversal_id) into result;
  insert into public.audit_logs(organization_id,actor_id,table_name,record_id,action,new_data)
  values(original.organization_id,auth.uid(),'transactions',original.id,'REVERSE',jsonb_build_object('reversal_id',reversal_id,'reason',trim(reason)));
  return result;
end; $$;
revoke all on function public.reverse_transaction(uuid,text) from public;
grant execute on function public.reverse_transaction(uuid,text) to authenticated;

create or replace function public.account_balance(target_account uuid, as_of date default current_date)
returns numeric language sql stable security definer set search_path = public as $$
  select a.opening_balance + coalesce(sum(case when t.id is not null then e.amount else 0 end),0)
  from public.accounts a
  left join public.transaction_entries e on e.account_id=a.id
  left join public.transactions t on t.id=e.transaction_id and t.status='posted' and t.transaction_date <= as_of
  where a.id=target_account and public.is_org_member(a.organization_id)
  group by a.id, a.opening_balance;
$$;
revoke all on function public.account_balance(uuid,date) from public;
grant execute on function public.account_balance(uuid,date) to authenticated;

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.organization_members enable row level security;
alter table public.accounts enable row level security;
alter table public.categories enable row level security;
alter table public.vendors enable row level security;
alter table public.transactions enable row level security;
alter table public.transaction_entries enable row level security;
alter table public.bills enable row level security;
alter table public.reconciliations enable row level security;
alter table public.attachments enable row level security;
alter table public.audit_logs enable row level security;

create policy organizations_read on public.organizations for select using (public.is_org_member(id));
create policy organizations_owner_update on public.organizations for update using (public.has_org_role(id,array['owner']::public.app_role[])) with check (public.has_org_role(id,array['owner']::public.app_role[]));
create policy profiles_self_read on public.profiles for select using (id=auth.uid() or exists(select 1 from public.organization_members mine join public.organization_members theirs using(organization_id) where mine.user_id=auth.uid() and theirs.user_id=profiles.id and mine.active and theirs.active));
create policy profiles_self_update on public.profiles for update using (id=auth.uid()) with check (id=auth.uid());
create policy members_read on public.organization_members for select using (public.is_org_member(organization_id));
create policy members_owner_write on public.organization_members for all using (public.has_org_role(organization_id,array['owner']::public.app_role[])) with check (public.has_org_role(organization_id,array['owner']::public.app_role[]));

create policy accounts_read on public.accounts for select using (public.is_org_member(organization_id));
create policy accounts_finance_write on public.accounts for all using (public.has_org_role(organization_id,array['owner','finance']::public.app_role[])) with check (public.has_org_role(organization_id,array['owner','finance']::public.app_role[]));
create policy categories_read on public.categories for select using (public.is_org_member(organization_id));
create policy categories_finance_write on public.categories for all using (public.has_org_role(organization_id,array['owner','finance']::public.app_role[])) with check (public.has_org_role(organization_id,array['owner','finance']::public.app_role[]));
create policy vendors_read on public.vendors for select using (public.is_org_member(organization_id));
create policy vendors_finance_write on public.vendors for all using (public.has_org_role(organization_id,array['owner','finance']::public.app_role[])) with check (public.has_org_role(organization_id,array['owner','finance']::public.app_role[]));

create policy transactions_read on public.transactions for select using (public.is_org_member(organization_id));
create policy transactions_create on public.transactions for insert with check (public.is_org_member(organization_id) and created_by=auth.uid() and status in ('draft','pending'));
create policy transactions_draft_update on public.transactions for update using (public.has_org_role(organization_id,array['owner','finance']::public.app_role[]) and status in ('draft','pending')) with check (public.has_org_role(organization_id,array['owner','finance']::public.app_role[]) and status in ('draft','pending'));
create policy entries_read on public.transaction_entries for select using (public.is_org_member(organization_id));
create policy entries_finance_create on public.transaction_entries for insert with check (public.has_org_role(organization_id,array['owner','finance']::public.app_role[]));
create policy entries_finance_update on public.transaction_entries for update using (public.has_org_role(organization_id,array['owner','finance']::public.app_role[])) with check (public.has_org_role(organization_id,array['owner','finance']::public.app_role[]));
create policy entries_finance_delete on public.transaction_entries for delete using (public.has_org_role(organization_id,array['owner','finance']::public.app_role[]));

create policy bills_read on public.bills for select using (public.is_org_member(organization_id));
create policy bills_finance_write on public.bills for all using (public.has_org_role(organization_id,array['owner','finance']::public.app_role[])) with check (public.has_org_role(organization_id,array['owner','finance']::public.app_role[]));
create policy reconciliations_read on public.reconciliations for select using (public.is_org_member(organization_id));
create policy reconciliations_finance_insert on public.reconciliations for insert with check (public.has_org_role(organization_id,array['owner','finance']::public.app_role[]) and reconciled_by=auth.uid());
create policy attachments_read on public.attachments for select using (public.is_org_member(organization_id));
create policy attachments_write on public.attachments for insert with check (public.is_org_member(organization_id) and uploaded_by=auth.uid());
create policy attachments_delete on public.attachments for delete using (uploaded_by=auth.uid() or public.has_org_role(organization_id,array['owner','finance']::public.app_role[]));
create policy audit_read on public.audit_logs for select using (public.has_org_role(organization_id,array['owner','finance','auditor']::public.app_role[]));

-- Never expose audit log writes to API roles.
revoke insert, update, delete on public.audit_logs from anon, authenticated;

-- Private bucket. Access is granted only when the first path segment is an organization UUID
-- and the authenticated user belongs to that organization.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('finance-documents','finance-documents',false,10485760,array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create policy finance_documents_read on storage.objects for select to authenticated
using (bucket_id='finance-documents' and public.is_org_member(((storage.foldername(name))[1])::uuid));
create policy finance_documents_insert on storage.objects for insert to authenticated
with check (bucket_id='finance-documents' and public.is_org_member(((storage.foldername(name))[1])::uuid) and owner_id::text=auth.uid()::text);
create policy finance_documents_delete on storage.objects for delete to authenticated
using (bucket_id='finance-documents' and (owner_id::text=auth.uid()::text or public.has_org_role(((storage.foldername(name))[1])::uuid,array['owner','finance']::public.app_role[])));
