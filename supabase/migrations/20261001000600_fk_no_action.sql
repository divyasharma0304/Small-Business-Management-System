-- =============================================================================
-- Switch ON DELETE RESTRICT foreign keys to NO ACTION.
--
-- Both refuse to delete a row that is still referenced (e.g. an item with stock
-- history). The difference: RESTRICT checks immediately, so deleting a whole
-- business — which cascades to both the referencing and referenced rows in one
-- statement — would fail. NO ACTION checks at the end of the statement.
-- =============================================================================
do $$
declare
  r record;
begin
  for r in
    select c.conname, c.conrelid::regclass as tbl, pg_get_constraintdef(c.oid) as def
    from pg_constraint c
    join pg_namespace n on n.oid = c.connamespace
    where n.nspname = 'public' and c.contype = 'f' and c.confdeltype = 'r'
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
    execute format('alter table %s add constraint %I %s', r.tbl, r.conname, replace(r.def, 'ON DELETE RESTRICT', ''));
  end loop;
end $$;
