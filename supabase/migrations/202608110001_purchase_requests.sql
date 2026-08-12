-- Purchase request workflow for office and operational needs.

create type public.purchase_request_status as enum ('draft','submitted','approved','purchased','received','rejected','cancelled');
create type public.purchase_urgency as enum ('normal','urgent');

create table public.purchase_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  request_sequence bigint generated always as identity,
  requested_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  department text not null check (char_length(department) between 2 and 80),
  title text not null check (char_length(title) between 2 and 120),
  purpose text not null check (char_length(purpose) between 5 and 500),
  urgency public.purchase_urgency not null default 'normal',
  status public.purchase_request_status not null default 'draft',
  preferred_vendor_id uuid references public.vendors(id) on delete set null,
  estimated_total numeric(20,2) not null default 0 check (estimated_total >= 0),
  approved_by uuid references public.profiles(id) on delete restrict,
  approved_at timestamptz,
  purchased_by uuid references public.profiles(id) on delete restrict,
  purchased_at timestamptz,
  received_by uuid references public.profiles(id) on delete restrict,
  received_at timestamptz,
  payment_transaction_id uuid references public.transactions(id) on delete restrict,
  rejection_reason text check (rejection_reason is null or char_length(rejection_reason) between 5 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, request_sequence),
  check ((status <> 'approved') or (approved_by is not null and approved_at is not null)),
  check ((status <> 'purchased') or (approved_by is not null and purchased_by is not null and purchased_at is not null)),
  check ((status <> 'received') or (received_by is not null and received_at is not null)),
  check ((status <> 'rejected') or rejection_reason is not null)
);

create table public.purchase_request_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  purchase_request_id uuid not null references public.purchase_requests(id) on delete cascade,
  item_name text not null check (char_length(item_name) between 2 and 160),
  description text check (description is null or char_length(description) <= 500),
  quantity numeric(12,2) not null check (quantity > 0),
  unit text not null default 'pcs' check (char_length(unit) between 1 and 20),
  estimated_unit_price numeric(20,2) not null check (estimated_unit_price >= 0),
  actual_unit_price numeric(20,2) check (actual_unit_price is null or actual_unit_price >= 0),
  created_at timestamptz not null default now()
);

create table public.purchase_request_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  purchase_request_id uuid not null references public.purchase_requests(id) on delete restrict,
  from_status public.purchase_request_status,
  to_status public.purchase_request_status not null,
  actor_id uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now()
);

create index purchase_requests_org_status_idx on public.purchase_requests(organization_id,status,created_at desc);
create index purchase_requests_requester_idx on public.purchase_requests(requested_by,created_at desc);
create index purchase_items_request_idx on public.purchase_request_items(purchase_request_id);
create index purchase_events_request_idx on public.purchase_request_events(purchase_request_id,created_at);

create or replace function public.validate_purchase_item_scope()
returns trigger language plpgsql set search_path=public as $$
declare request_org uuid; request_status public.purchase_request_status; request_owner uuid; target_request uuid; target_org uuid;
begin
  target_request := coalesce(new.purchase_request_id,old.purchase_request_id);
  target_org := coalesce(new.organization_id,old.organization_id);
  select organization_id,status,requested_by into request_org,request_status,request_owner from public.purchase_requests where id=target_request;
  if request_org is null or request_org <> target_org then raise exception 'Cross-organization purchase item is forbidden' using errcode='23514'; end if;
  if request_status <> 'draft' then raise exception 'Items can only be changed while the request is a draft' using errcode='55000'; end if;
  if request_owner <> auth.uid() and not public.has_org_role(request_org,array['owner','finance']::public.app_role[]) then raise exception 'Insufficient permission' using errcode='42501'; end if;
  return coalesce(new,old);
end; $$;
create trigger validate_purchase_item_before_write before insert or update or delete on public.purchase_request_items
for each row execute function public.validate_purchase_item_scope();

create or replace function public.refresh_purchase_total()
returns trigger language plpgsql security definer set search_path=public as $$
declare target_request uuid;
begin
  target_request := coalesce(new.purchase_request_id,old.purchase_request_id);
  update public.purchase_requests
  set estimated_total=coalesce((select sum(quantity*estimated_unit_price) from public.purchase_request_items where purchase_request_id=target_request),0)
  where id=target_request;
  return coalesce(new,old);
end; $$;
create trigger refresh_purchase_total_after_change after insert or update or delete on public.purchase_request_items
for each row execute function public.refresh_purchase_total();

create or replace function public.guard_purchase_request_update()
returns trigger language plpgsql set search_path=public as $$
begin
  if old.status <> 'draft' and not public.has_org_role(old.organization_id,array['owner','finance']::public.app_role[]) then
    if row(old.title,old.purpose,old.department,old.urgency,old.preferred_vendor_id) is distinct from row(new.title,new.purpose,new.department,new.urgency,new.preferred_vendor_id) then
      raise exception 'Submitted request details are locked' using errcode='55000';
    end if;
  end if;
  if old.status is distinct from new.status then
    if old.status='draft' and new.status='submitted' and old.requested_by=auth.uid() then null;
    elsif old.status='submitted' and new.status in ('approved','rejected') and public.has_org_role(old.organization_id,array['owner','finance']::public.app_role[]) then null;
    elsif old.status='approved' and new.status='purchased' and public.has_org_role(old.organization_id,array['owner','finance']::public.app_role[]) then null;
    elsif old.status='purchased' and new.status='received' and (old.requested_by=auth.uid() or public.has_org_role(old.organization_id,array['owner','finance']::public.app_role[])) then null;
    elsif old.status in ('draft','submitted') and new.status='cancelled' and old.requested_by=auth.uid() then null;
    else raise exception 'Invalid or unauthorized purchase status transition: % to %',old.status,new.status using errcode='42501';
    end if;
  end if;
  new.updated_at=now();
  return new;
end; $$;
create trigger guard_purchase_request_before_update before update on public.purchase_requests
for each row execute function public.guard_purchase_request_update();

create trigger audit_purchase_requests after insert or update or delete on public.purchase_requests
for each row execute function public.audit_row_change();

create or replace function public.create_purchase_request(
  target_org uuid,
  request_title text,
  request_purpose text,
  request_department text,
  request_urgency public.purchase_urgency,
  items jsonb
)
returns public.purchase_requests language plpgsql security definer set search_path=public as $$
declare created public.purchase_requests; item jsonb;
begin
  if not public.is_org_member(target_org) then raise exception 'Insufficient permission' using errcode='42501'; end if;
  if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) < 1 or jsonb_array_length(items) > 50 then raise exception 'Provide between 1 and 50 items'; end if;
  insert into public.purchase_requests(organization_id,requested_by,department,title,purpose,urgency,status)
  values(target_org,auth.uid(),trim(request_department),trim(request_title),trim(request_purpose),request_urgency,'draft') returning * into created;
  for item in select * from jsonb_array_elements(items) loop
    insert into public.purchase_request_items(organization_id,purchase_request_id,item_name,description,quantity,unit,estimated_unit_price)
    values(target_org,created.id,trim(item->>'name'),nullif(trim(item->>'description'),''),(item->>'quantity')::numeric,coalesce(nullif(trim(item->>'unit'),''),'pcs'),(item->>'unit_price')::numeric);
  end loop;
  update public.purchase_requests set status='submitted' where id=created.id returning * into created;
  insert into public.purchase_request_events(organization_id,purchase_request_id,from_status,to_status,actor_id,note)
  values(target_org,created.id,'draft','submitted',auth.uid(),'Request submitted');
  return created;
exception when others then
  raise;
end; $$;
revoke all on function public.create_purchase_request(uuid,text,text,text,public.purchase_urgency,jsonb) from public;
grant execute on function public.create_purchase_request(uuid,text,text,text,public.purchase_urgency,jsonb) to authenticated;

create or replace function public.transition_purchase_request(target_request uuid,next_status public.purchase_request_status,note text default null)
returns public.purchase_requests language plpgsql security definer set search_path=public as $$
declare current_request public.purchase_requests; updated_request public.purchase_requests;
begin
  select * into current_request from public.purchase_requests where id=target_request for update;
  if current_request.id is null then raise exception 'Purchase request not found' using errcode='P0002'; end if;
  if next_status='rejected' and (note is null or char_length(trim(note)) < 5) then raise exception 'A rejection reason of at least 5 characters is required'; end if;
  update public.purchase_requests set
    status=next_status,
    approved_by=case when next_status='approved' then auth.uid() else approved_by end,
    approved_at=case when next_status='approved' then now() else approved_at end,
    purchased_by=case when next_status='purchased' then auth.uid() else purchased_by end,
    purchased_at=case when next_status='purchased' then now() else purchased_at end,
    received_by=case when next_status='received' then auth.uid() else received_by end,
    received_at=case when next_status='received' then now() else received_at end,
    rejection_reason=case when next_status='rejected' then nullif(trim(note),'') else rejection_reason end
  where id=target_request returning * into updated_request;
  insert into public.purchase_request_events(organization_id,purchase_request_id,from_status,to_status,actor_id,note)
  values(current_request.organization_id,current_request.id,current_request.status,next_status,auth.uid(),nullif(trim(note),''));
  return updated_request;
end; $$;
revoke all on function public.transition_purchase_request(uuid,public.purchase_request_status,text) from public;
grant execute on function public.transition_purchase_request(uuid,public.purchase_request_status,text) to authenticated;

alter table public.attachments add column purchase_request_id uuid references public.purchase_requests(id) on delete cascade;
alter table public.attachments drop constraint if exists attachments_check;
alter table public.attachments add constraint attachment_single_parent
check ((transaction_id is not null)::int + (bill_id is not null)::int + (purchase_request_id is not null)::int = 1);

alter table public.purchase_requests enable row level security;
alter table public.purchase_request_items enable row level security;
alter table public.purchase_request_events enable row level security;

create policy purchase_requests_read on public.purchase_requests for select using (public.is_org_member(organization_id));
create policy purchase_requests_insert on public.purchase_requests for insert with check (public.is_org_member(organization_id) and requested_by=auth.uid() and status in ('draft','submitted'));
create policy purchase_requests_update_own on public.purchase_requests for update using (requested_by=auth.uid()) with check (requested_by=auth.uid() and public.is_org_member(organization_id));
create policy purchase_requests_finance_update on public.purchase_requests for update using (public.has_org_role(organization_id,array['owner','finance']::public.app_role[])) with check (public.has_org_role(organization_id,array['owner','finance']::public.app_role[]));
create policy purchase_items_read on public.purchase_request_items for select using (public.is_org_member(organization_id));
create policy purchase_items_insert on public.purchase_request_items for insert with check (public.is_org_member(organization_id));
create policy purchase_items_update on public.purchase_request_items for update using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy purchase_items_delete on public.purchase_request_items for delete using (public.is_org_member(organization_id));
create policy purchase_events_read on public.purchase_request_events for select using (public.is_org_member(organization_id));

revoke insert,update,delete on public.purchase_request_events from anon,authenticated;
