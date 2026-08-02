-- M3.2: the last_engaged_at/engagement_count derived-field trigger docs/01-domain-model.md's
-- "Derived values - never hand-maintained" table specifies, deliberately left out of migration
-- 0008 (M3.1) since docs/07-build-backlog.md names this as M3.2's own deliverable ("logActivity
-- service: the single creation path, deriving last_engaged_at, engagement_count... in one
-- transaction"). A trigger, not application code, is what actually makes "in one transaction" true
-- here - the same reasoning migration 0006 (updated_at/updated_by) and migration 0007
-- (duration_in_previous_seconds/is_regression) already established: a Supabase-client caller has no
-- multi-statement transaction available to it (src/services/audit.ts's own comment), but a single
-- INSERT firing an AFTER INSERT trigger is genuinely one transaction.
--
-- Matches db/schema.sql's own refresh_deal_engagement() function verbatim - unlike migration
-- 0007's is_regression, this derivation only needs same-table aggregation (every activities row for
-- one deal_id), so there is no cross-table-generated-column obstacle to work around here.
--
-- last_engaged_at: max activity_date where is_client_facing and not retracted.
-- last_engaged_activity_id: the specific activity that produced that max date.
-- engagement_count: count of ALL non-retracted activities (not just client-facing ones) -
-- docs/01-domain-model.md's own distinction, easy to miss since the two rows sit next to each
-- other in that table but use different filters.
create or replace function refresh_deal_engagement() returns trigger
language plpgsql security definer as $$
begin
  update deals d set
    last_engaged_at = sub.max_date,
    last_engaged_activity_id = sub.latest_id,
    engagement_count = sub.total,
    updated_at = now()
  from (
    select
      max(a.activity_date) filter (where a.is_client_facing) as max_date,
      (select id from activities x
        where x.deal_id = coalesce(new.deal_id, old.deal_id)
          and x.is_client_facing and x.retracted_at is null
        order by x.activity_date desc, x.created_at desc limit 1) as latest_id,
      count(*) filter (where a.retracted_at is null) as total
    from activities a
    where a.deal_id = coalesce(new.deal_id, old.deal_id) and a.retracted_at is null
  ) sub
  where d.id = coalesce(new.deal_id, old.deal_id);
  return null;
end $$;

-- AFTER INSERT OR UPDATE, not just INSERT: an edit within the 24h window (e.g. correcting
-- activity_date or type) must recompute these too, and so must a future retraction (M3.6, which
-- writes via UPDATE, not a separate table) - this trigger already handles that case correctly
-- since it recomputes from scratch every time, not incrementally.
create trigger trg_activity_refresh
  after insert or update on activities
  for each row execute function refresh_deal_engagement();
