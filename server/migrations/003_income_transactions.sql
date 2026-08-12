alter table transactions
  add column counterparty varchar(120),
  add column invoice_number varchar(80),
  add column income_source varchar(30);

create index transactions_org_reference_idx on transactions(organization_id, lower(reference)) where reference is not null;
create index transactions_org_income_source_idx on transactions(organization_id, income_source) where income_source is not null;
