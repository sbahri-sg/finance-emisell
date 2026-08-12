alter table budget_categories
  add column if not exists budget_model varchar(16) not null default 'fixed',
  add column if not exists line_items jsonb not null default '[]'::jsonb;

alter table budget_categories drop constraint if exists budget_categories_budget_model_check;
alter table budget_categories add constraint budget_categories_budget_model_check check (budget_model in ('fixed','multi_item'));
alter table budget_categories drop constraint if exists budget_categories_line_items_check;
alter table budget_categories add constraint budget_categories_line_items_check check (jsonb_typeof(line_items)='array');

update budget_categories
set budget_model='multi_item',
    line_items=(
      select coalesce(jsonb_agg(jsonb_build_object('name',detail,'quantity',1,'unitPrice',0)),'[]'::jsonb)
      from unnest(details) detail
    )
where cardinality(details)>0 and line_items='[]'::jsonb;

alter table transactions add column if not exists budget_item_name varchar(80);
