alter table transactions add column if not exists replaces_transaction_id uuid references transactions(id);
create unique index if not exists transactions_one_replacement_per_original on transactions(replaces_transaction_id) where replaces_transaction_id is not null;
