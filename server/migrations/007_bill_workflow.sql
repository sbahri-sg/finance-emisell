alter table bills
  add column reminder_days integer[] not null default '{14,7,1}',
  add column paid_transaction_id uuid unique references transactions(id) on delete restrict,
  add column paid_at timestamptz,
  add column paid_by uuid references users(id),
  add constraint bills_recurrence_check check(recurrence in('monthly','yearly','once')),
  add constraint bills_status_check check(status in('upcoming','due','paid','overdue','cancelled')),
  add constraint bills_reminder_days_check check(reminder_days <@ array[1,3,7,14,30]);

create index bills_org_due_status_idx on bills(organization_id,due_date,status);
