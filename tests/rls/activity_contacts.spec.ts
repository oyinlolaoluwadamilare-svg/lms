import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { asUser, migratorClient } from "./support";

// M5.7 exit criteria (docs/07-build-backlog.md): "Activity attribution to contacts; contact-level
// last-engaged." Proves migration 0019's RLS shape (activity_contacts mirrors activities_select/
// activities_insert exactly, through the activity's own deal_id - own/practice/practice/denied/
// tenant, insert+select only), the trg_validate_activity_contact backstop (a contact must already
// be linked to the activity's deal via deal_contacts), and both engagement-refresh triggers: initial
// attribution sets contacts.last_engaged_at, and retracting the underlying activity resets it.

let migrator: pg.Client;

const ids = {
  tenantA: "",
  tenantB: "",
  practiceA: "",
  otherPracticeA: "",
  bdeA: "",
  otherPracticeUserA: "",
  accountA: "",
  stageA: "",
  dealA: "",
  linkedContact: "",
  notLinkedContact: "",
  activityA: "",
};

async function makeUser(tenantId: string, email: string) {
  const { rows } = await migrator.query(
    `insert into users (id, tenant_id, full_name, email, status)
     values (uuid_generate_v4(), $1, $2, $3, 'active') returning id`,
    [tenantId, email, email],
  );
  return rows[0].id;
}

async function grant(tenantId: string, userId: string, role: string, practiceLineId: string | null) {
  await migrator.query("insert into user_roles (tenant_id, user_id, role, practice_line_id) values ($1, $2, $3, $4)", [
    tenantId,
    userId,
    role,
    practiceLineId,
  ]);
}

async function seed() {
  migrator = await migratorClient();
  await migrator.query(
    "truncate activity_contacts, activities, deal_contacts, contacts, deals, accounts, pipeline_stages, user_roles, users, practice_lines, tenants cascade",
  );

  const tenantA = await migrator.query("insert into tenants (name, slug) values ('Tenant A', 'tenant-a-activity-contacts') returning id");
  const tenantB = await migrator.query("insert into tenants (name, slug) values ('Tenant B', 'tenant-b-activity-contacts') returning id");
  ids.tenantA = tenantA.rows[0].id;
  ids.tenantB = tenantB.rows[0].id;

  const practiceA = await migrator.query(
    "insert into practice_lines (tenant_id, name, code) values ($1, 'Advisory', 'ADV') returning id",
    [ids.tenantA],
  );
  ids.practiceA = practiceA.rows[0].id;
  const otherPracticeA = await migrator.query(
    "insert into practice_lines (tenant_id, name, code) values ($1, 'Executive Search', 'ES') returning id",
    [ids.tenantA],
  );
  ids.otherPracticeA = otherPracticeA.rows[0].id;

  ids.bdeA = await makeUser(ids.tenantA, "bde-activity-contacts-a@example.com");
  ids.otherPracticeUserA = await makeUser(ids.tenantA, "other-practice-activity-contacts-a@example.com");
  await grant(ids.tenantA, ids.bdeA, "bde", ids.practiceA);
  await grant(ids.tenantA, ids.otherPracticeUserA, "bde", ids.otherPracticeA);

  const accountA = await migrator.query("insert into accounts (tenant_id, name) values ($1, 'Activity Contacts Test Account') returning id", [
    ids.tenantA,
  ]);
  ids.accountA = accountA.rows[0].id;

  const stageA = await migrator.query(
    "insert into pipeline_stages (tenant_id, name, code, sort_order, probability_threshold, stage_type) values ($1, 'Discovery', 'DISCOVERY', 1, 20, 'open') returning id",
    [ids.tenantA],
  );
  ids.stageA = stageA.rows[0].id;

  const dealA = await migrator.query(
    `insert into deals (tenant_id, reference, name, account_id, practice_line_id, stage_id, client_type, owner_id, author_id, status, expected_close_date)
     values ($1, 'D-ACTIVITY-CONTACTS-1', 'Activity contacts test deal', $2, $3, $4, 'new', $5, $5, 'active', current_date + 30) returning id`,
    [ids.tenantA, ids.accountA, ids.practiceA, ids.stageA, ids.bdeA],
  );
  ids.dealA = dealA.rows[0].id;

  const linkedContact = await migrator.query("insert into contacts (tenant_id, account_id, first_name) values ($1, $2, 'Linked') returning id", [
    ids.tenantA,
    ids.accountA,
  ]);
  ids.linkedContact = linkedContact.rows[0].id;
  const notLinkedContact = await migrator.query(
    "insert into contacts (tenant_id, account_id, first_name) values ($1, $2, 'NotLinked') returning id",
    [ids.tenantA, ids.accountA],
  );
  ids.notLinkedContact = notLinkedContact.rows[0].id;

  await migrator.query("insert into deal_contacts (deal_id, contact_id, is_primary, added_by) values ($1, $2, true, $3)", [
    ids.dealA,
    ids.linkedContact,
    ids.bdeA,
  ]);

  // A client-facing type ('call') so the engagement-refresh triggers below have something to
  // advance last_engaged_at to.
  const activityA = await migrator.query(
    `insert into activities (tenant_id, deal_id, type, activity_date, summary, author_id)
     values ($1, $2, 'call', current_date - 1, 'Activity contacts test call', $3) returning id`,
    [ids.tenantA, ids.dealA, ids.bdeA],
  );
  ids.activityA = activityA.rows[0].id;
}

beforeAll(seed);
afterAll(async () => {
  await migrator.end();
});

async function tryQuery(client: pg.Client, sql: string, params: unknown[]): Promise<pg.QueryResult | false> {
  try {
    return await client.query(sql, params);
  } catch (err) {
    if (err instanceof Error && /row-level security/.test(err.message)) return false;
    throw err;
  }
}

describe("trg_validate_activity_contact: a contact must already be linked to the activity's deal", () => {
  it("rejects attributing a contact never linked via deal_contacts", async () => {
    await expect(
      migrator.query("insert into activity_contacts (activity_id, contact_id) values ($1, $2)", [ids.activityA, ids.notLinkedContact]),
    ).rejects.toThrow(/is not linked to the deal/);
  });
});

describe("activity_contacts RLS: mirrors activities_select/activities_insert exactly", () => {
  it("the deal's own bde owner can attribute an already-linked contact and read the row back", async () => {
    const client = await asUser(ids.bdeA);
    const inserted = await tryQuery(client, "insert into activity_contacts (activity_id, contact_id) values ($1, $2)", [
      ids.activityA,
      ids.linkedContact,
    ]);
    expect(inserted).not.toBe(false);

    const { rows } = await client.query("select activity_id, contact_id from activity_contacts where activity_id = $1", [ids.activityA]);
    await client.end();
    expect(rows).toEqual([{ activity_id: ids.activityA, contact_id: ids.linkedContact }]);
  });

  it("a bde outside the deal's practice cannot attribute a contact to this activity", async () => {
    const client = await asUser(ids.otherPracticeUserA);
    const inserted = await tryQuery(client, "insert into activity_contacts (activity_id, contact_id) values ($1, $2)", [
      ids.activityA,
      ids.linkedContact,
    ]);
    await client.end();
    expect(inserted).toBe(false);
  });

  it("a bde outside the deal's practice cannot see the attribution either", async () => {
    const client = await asUser(ids.otherPracticeUserA);
    const { rows } = await client.query("select activity_id from activity_contacts where activity_id = $1", [ids.activityA]);
    await client.end();
    expect(rows).toHaveLength(0);
  });

  it("a user in a different tenant cannot see it at all", async () => {
    const otherTenantUser = await makeUser(ids.tenantB, "user-b-activity-contacts@example.com");
    await grant(ids.tenantB, otherTenantUser, "tenant_admin", null);
    const client = await asUser(otherTenantUser);
    const { rows } = await client.query("select activity_id from activity_contacts where activity_id = $1", [ids.activityA]);
    await client.end();
    expect(rows).toHaveLength(0);
  });

  it("no update or delete policy - attributions are permanent, matching activities' own append-only discipline", async () => {
    const client = await asUser(ids.bdeA);
    const deleteResult = await client.query("delete from activity_contacts where activity_id = $1 and contact_id = $2", [
      ids.activityA,
      ids.linkedContact,
    ]);
    await client.end();
    expect(deleteResult.rowCount).toBe(0);

    const { rows } = await migrator.query("select 1 from activity_contacts where activity_id = $1 and contact_id = $2", [
      ids.activityA,
      ids.linkedContact,
    ]);
    expect(rows).toHaveLength(1);
  });
});

describe("engagement-refresh triggers: contacts.last_engaged_at", () => {
  it("advances to the attributed activity's own activity_date on attribution", async () => {
    const { rows } = await migrator.query("select last_engaged_at from contacts where id = $1", [ids.linkedContact]);
    const { rows: activityRows } = await migrator.query("select activity_date from activities where id = $1", [ids.activityA]);
    expect(rows[0].last_engaged_at.toISOString().slice(0, 10)).toBe(activityRows[0].activity_date.toISOString().slice(0, 10));
  });

  it("resets to null when the only qualifying activity is retracted", async () => {
    await migrator.query(
      "update activities set retracted_at = now(), retracted_by = $2, retraction_reason = 'rls test retraction' where id = $1",
      [ids.activityA, ids.bdeA],
    );
    const { rows } = await migrator.query("select last_engaged_at from contacts where id = $1", [ids.linkedContact]);
    expect(rows[0].last_engaged_at).toBeNull();
  });
});
