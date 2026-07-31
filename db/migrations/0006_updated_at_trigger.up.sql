-- M1.5: src/services/deals.ts's changeStage is the first application code path that ever UPDATEs
-- a deals row. Neither `deals` nor `accounts` (the only two tables carrying updated_at/updated_by -
-- M1.1) had a trigger maintaining either column, so without this, updated_at would stay frozen at
-- insert time forever and updated_by would depend on every future caller remembering to set it by
-- hand - exactly the class of bug the single-path philosophy (docs/03-architecture.md) exists to
-- prevent. A trigger makes both columns correct-by-construction for every present and future write
-- path, the same way author_id is pinned server-side rather than trusted from a caller.
--
-- updated_by is set from auth.uid(), not a caller-supplied value: the same reasoning as author_id
-- in migration 0005 - a value the caller decides is a value the caller can fake. auth.uid() is null
-- for a service-role client (seed scripts, tests' cleanup helpers), which is correct: there is no
-- real acting user in those cases, and updated_by is nullable for exactly this reason.
create or replace function set_updated_at_and_by()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  new.updated_by = auth.uid();
  return new;
end;
$$;

create trigger deals_set_updated_at
  before update on deals
  for each row execute function set_updated_at_and_by();

create trigger accounts_set_updated_at
  before update on accounts
  for each row execute function set_updated_at_and_by();
