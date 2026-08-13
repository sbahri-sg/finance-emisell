alter table transactions drop constraint if exists transactions_payment_method_check;
alter table transactions add constraint transactions_payment_method_check
  check (payment_method is null or payment_method in ('transfer','ewallet','cash','vcc'));

alter table bills drop constraint if exists bills_payment_method_check;
alter table bills add constraint bills_payment_method_check
  check (payment_method is null or payment_method in ('transfer','ewallet','cash','vcc'));
