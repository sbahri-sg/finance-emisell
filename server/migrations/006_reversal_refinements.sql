alter table transactions drop constraint if exists transactions_purchase_request_id_key;

create index transactions_purchase_request_idx on transactions(purchase_request_id) where purchase_request_id is not null;
