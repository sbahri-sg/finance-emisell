update budget_categories bc
set line_items=(
  select coalesce(jsonb_agg(
    case when item ? 'id' then item else jsonb_build_object('id',gen_random_uuid()) || item end
    order by ordinal
  ),'[]'::jsonb)
  from jsonb_array_elements(bc.line_items) with ordinality source(item,ordinal)
)
where bc.budget_model='multi_item';

create table transaction_budget_items(
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references transactions(id) on delete restrict,
  budget_category_id uuid not null references budget_categories(id) on delete restrict,
  budget_item_id uuid not null,
  item_name varchar(80) not null,
  quantity integer not null check(quantity>0),
  planned_unit_price numeric(18,2) not null check(planned_unit_price>=0),
  actual_unit_price numeric(18,2) not null check(actual_unit_price>=0),
  subtotal numeric(18,2) not null check(subtotal>=0),
  created_at timestamptz not null default now(),
  unique(transaction_id,budget_item_id)
);
create index transaction_budget_items_budget_item_idx on transaction_budget_items(budget_category_id,budget_item_id);

insert into transaction_budget_items(transaction_id,budget_category_id,budget_item_id,item_name,quantity,planned_unit_price,actual_unit_price,subtotal)
select t.id,t.budget_category_id,(item->>'id')::uuid,item->>'name',1,
  coalesce((item->>'unitPrice')::numeric,0),amount.amount,amount.amount
from transactions t
join budget_categories bc on bc.id=t.budget_category_id
cross join lateral jsonb_array_elements(bc.line_items) item
cross join lateral(
  select coalesce(sum(abs(te.amount)),0)::numeric amount
  from transaction_entries te join accounts a on a.id=te.account_id
  where te.transaction_id=t.id and a.kind in('bank','cash','ewallet')
) amount
where t.kind='expense' and t.budget_item_name is not null
  and lower(item->>'name')=lower(t.budget_item_name)
on conflict do nothing;
