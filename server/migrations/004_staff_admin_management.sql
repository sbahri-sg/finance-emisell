alter table users drop constraint users_role_check;
alter table users add constraint users_role_check check(role in('owner','admin','finance','staff'));
create index users_org_active_idx on users(organization_id, active, role);
