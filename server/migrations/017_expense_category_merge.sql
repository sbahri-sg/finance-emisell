create or replace function protect_posted_transaction() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status in ('posted','reversed') then
      raise exception 'Posted transactions are immutable';
    end if;
    return old;
  end if;

  if old.status in ('posted','reversed')
    and (to_jsonb(new) - 'expense_category_id') is distinct from (to_jsonb(old) - 'expense_category_id') then
    raise exception 'Posted transactions are immutable';
  end if;
  return new;
end $$;

comment on function protect_posted_transaction() is
  'Posted journals are immutable; only expense category reassignment is allowed for audited category merges.';
