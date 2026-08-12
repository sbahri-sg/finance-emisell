alter table transactions add column if not exists payment_method varchar(20);
alter table transactions add column if not exists proof_url varchar(500);
alter table transactions add constraint transactions_payment_method_check check (payment_method is null or payment_method in ('transfer','ewallet','cash'));

alter table bills add column if not exists unit_price numeric(20,2);
alter table bills add column if not exists quantity numeric(12,2);
alter table bills add column if not exists payment_method varchar(20);
update bills set unit_price=amount,quantity=1 where unit_price is null or quantity is null;
alter table bills alter column unit_price set default 0;
alter table bills alter column quantity set default 1;
alter table bills add constraint bills_unit_price_check check (unit_price>=0);
alter table bills add constraint bills_quantity_check check (quantity>0);
alter table bills add constraint bills_payment_method_check check (payment_method is null or payment_method in ('transfer','ewallet','cash'));

alter table budget_categories add column if not exists expense_category varchar(80);
alter table budget_categories add column if not exists details text[] not null default '{}';
