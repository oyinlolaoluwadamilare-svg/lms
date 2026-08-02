import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { asUser, migratorClient } from "./support";

// M3.8 exit criteria (docs/07-build-backlog.md): "Attachments on activities, inheriting deal
// visibility." This proves migration 0010's RLS shape: documents_select "inherits deal visibility"
// (practice for bde/team_lead/director, tenant-wide for executive/tenant_admin - the SAME scope
// activities_select already uses, via the same deal_practice_line_id() helper), documents_insert
// mirrors activity.attach_file's own/practice/practice/denied/tenant scope, the derived
// practice_line_id capture, the storage_path/size_bytes/file_name constraints, and the deliberate
// absence of any UPDATE policy (document.soft_delete is out of scope for M3.8 - see the migration's
// own comment for why, including a genuine RLS mechanics finding worth not rediscovering later).

let migrator: pg.Client;

const ids = {
  tenantA: "",
  tenantB: "",
  practiceA1: "",
  practiceA2: "",
  practiceB1: "",
  adminA: "",
  execA: "",
  directorA: "",
  teamLeadA: "",
  bdeA1: "",
  bdeA2: "",
  otherPracticeUser: "",
  otherTenantUser: "",
  stageDiscovery: "",
  accountA: "",
  accountB: "",
  dealOwnedByBde1: "",
  dealOtherTenant: "",
  activityOnDealA: "",
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
  await migrator.query(
    "insert into user_roles (tenant_id, user_id, role, practice_line_id) values ($1, $2, $3, $4)",
    [tenantId, userId, role, practiceLineId],
  );
}

let documentCounter = 0;
function uniqueStoragePath(): string {
  documentCounter += 1;
  return `test/${ids.tenantA || "seed"}/${documentCounter}-${Date.now()}.pdf`;
}

async function seed() {
  migrator = await migratorClient();
  await migrator.query(
    "truncate documents, activities, deal_co_owners, deals, accounts, pipeline_stages, user_roles, users, practice_lines, tenants cascade",
  );

  const tenantA = await migrator.query("insert into tenants (name, slug) values ('Tenant A', 'tenant-a-documents') returning id");
  const tenantB = await migrator.query("insert into tenants (name, slug) values ('Tenant B', 'tenant-b-documents') returning id");
  ids.tenantA = tenantA.rows[0].id;
  ids.tenantB = tenantB.rows[0].id;

  const practiceA1 = await migrator.query(
    "insert into practice_lines (tenant_id, name, code) values ($1, 'Advisory', 'ADV') returning id",
    [ids.tenantA],
  );
  const practiceA2 = await migrator.query(
    "insert into practice_lines (tenant_id, name, code) values ($1, 'Executive Search', 'ES') returning id",
    [ids.tenantA],
  );
  const practiceB1 = await migrator.query(
    "insert into practice_lines (tenant_id, name, code) values ($1, 'Advisory', 'ADV') returning id",
    [ids.tenantB],
  );
  ids.practiceA1 = practiceA1.rows[0].id;
  ids.practiceA2 = practiceA2.rows[0].id;
  ids.practiceB1 = practiceB1.rows[0].id;

  ids.adminA = await makeUser(ids.tenantA, "admin-a@example.com");
  ids.execA = await makeUser(ids.tenantA, "exec-a@example.com");
  ids.directorA = await makeUser(ids.tenantA, "director-a@example.com");
  ids.teamLeadA = await makeUser(ids.tenantA, "team-lead-a@example.com");
  ids.bdeA1 = await makeUser(ids.tenantA, "bde-a1@example.com");
  ids.bdeA2 = await makeUser(ids.tenantA, "bde-a2@example.com");
  ids.otherPracticeUser = await makeUser(ids.tenantA, "other-practice@example.com");
  ids.otherTenantUser = await makeUser(ids.tenantB, "other-tenant@example.com");

  await grant(ids.tenantA, ids.adminA, "tenant_admin", null);
  await grant(ids.tenantA, ids.execA, "executive", null);
  await grant(ids.tenantA, ids.directorA, "director", ids.practiceA1);
  await grant(ids.tenantA, ids.teamLeadA, "team_lead", ids.practiceA1);
  await grant(ids.tenantA, ids.bdeA1, "bde", ids.practiceA1);
  await grant(ids.tenantA, ids.bdeA2, "bde", ids.practiceA1);
  await grant(ids.tenantA, ids.otherPracticeUser, "bde", ids.practiceA2);
  await grant(ids.tenantB, ids.otherTenantUser, "bde", ids.practiceB1);

  const stageDiscovery = await migrator.query(
    `insert into pipeline_stages (tenant_id, name, code, sort_order, probability_threshold, stage_type)
     values ($1, 'Discovery', 'DISCOVERY', 1, 10, 'open') returning id`,
    [ids.tenantA],
  );
  ids.stageDiscovery = stageDiscovery.rows[0].id;

  const stageB = await migrator.query(
    `insert into pipeline_stages (tenant_id, name, code, sort_order, probability_threshold, stage_type)
     values ($1, 'Discovery', 'DISCOVERY', 1, 10, 'open') returning id`,
    [ids.tenantB],
  );

  const accountA = await migrator.query("insert into accounts (tenant_id, name) values ($1, 'Client A') returning id", [ids.tenantA]);
  const accountB = await migrator.query("insert into accounts (tenant_id, name) values ($1, 'Client B') returning id", [ids.tenantB]);
  ids.accountA = accountA.rows[0].id;
  ids.accountB = accountB.rows[0].id;

  const dealA = await migrator.query(
    `insert into deals (tenant_id, reference, name, account_id, practice_line_id, stage_id, client_type,
       owner_id, author_id, status, expected_close_date)
     values ($1, 'D-DOC-A', 'Deal A', $2, $3, $4, 'new', $5, $5, 'active', current_date + 30)
     returning id`,
    [ids.tenantA, ids.accountA, ids.practiceA1, ids.stageDiscovery, ids.bdeA1],
  );
  ids.dealOwnedByBde1 = dealA.rows[0].id;

  const dealB = await migrator.query(
    `insert into deals (tenant_id, reference, name, account_id, practice_line_id, stage_id, client_type,
       owner_id, author_id, status, expected_close_date)
     values ($1, 'D-DOC-B', 'Deal B', $2, $3, $4, 'new', $5, $5, 'active', current_date + 30)
     returning id`,
    [ids.tenantB, ids.accountB, ids.practiceB1, stageB.rows[0].id, ids.otherTenantUser],
  );
  ids.dealOtherTenant = dealB.rows[0].id;

  const activityA = await migrator.query(
    `insert into activities (tenant_id, deal_id, type, activity_date, summary, author_id)
     values ($1, $2, 'note', current_date, 'Activity to attach a file to', $3) returning id`,
    [ids.tenantA, ids.dealOwnedByBde1, ids.bdeA1],
  );
  ids.activityOnDealA = activityA.rows[0].id;
}

beforeAll(seed);
afterAll(async () => {
  await migrator.end();
});

async function tryInsert(client: pg.Client, sql: string, params: unknown[]): Promise<boolean> {
  try {
    const result = await client.query(sql, params);
    return (result.rowCount ?? 0) > 0;
  } catch (err) {
    if (err instanceof Error && /row-level security/.test(err.message)) return false;
    throw err;
  }
}

function insertDocumentSql() {
  return `insert into documents (tenant_id, deal_id, activity_id, file_name, storage_path, mime_type, size_bytes, uploaded_by)
          values ($1, $2, $3, $4, $5, $6, $7, $8)`;
}

describe("migration 0010: derived behaviour", () => {
  it("practice_line_id is captured from the deal at insert time, regardless of what the caller passes", async () => {
    const { rows } = await migrator.query(
      `insert into documents (tenant_id, deal_id, activity_id, file_name, storage_path, mime_type, size_bytes, uploaded_by, practice_line_id)
       values ($1, $2, $3, 'brief.pdf', $4, 'application/pdf', 1024, $5, $6)
       returning practice_line_id`,
      [ids.tenantA, ids.dealOwnedByBde1, ids.activityOnDealA, uniqueStoragePath(), ids.bdeA1, ids.practiceA2], // deliberately wrong, to prove the trigger overrides it
    );
    expect(rows[0].practice_line_id).toBe(ids.practiceA1);
  });

  it("a null deal_id leaves practice_line_id null - there is no deal to derive it from", async () => {
    const { rows } = await migrator.query(
      `insert into documents (tenant_id, file_name, storage_path, mime_type, size_bytes, uploaded_by)
       values ($1, 'standalone.pdf', $2, 'application/pdf', 1024, $3) returning practice_line_id`,
      [ids.tenantA, uniqueStoragePath(), ids.bdeA1],
    );
    expect(rows[0].practice_line_id).toBeNull();
  });
});

describe("migration 0010: constraints", () => {
  it("rejects an empty file_name", async () => {
    await expect(
      migrator.query(
        insertDocumentSql(),
        [ids.tenantA, ids.dealOwnedByBde1, ids.activityOnDealA, "   ", uniqueStoragePath(), "application/pdf", 1024, ids.bdeA1],
      ),
    ).rejects.toThrow();
  });

  it("rejects a non-positive size_bytes", async () => {
    await expect(
      migrator.query(
        insertDocumentSql(),
        [ids.tenantA, ids.dealOwnedByBde1, ids.activityOnDealA, "empty.pdf", uniqueStoragePath(), "application/pdf", 0, ids.bdeA1],
      ),
    ).rejects.toThrow();
  });

  it("rejects a duplicate storage_path", async () => {
    const path = uniqueStoragePath();
    await migrator.query(insertDocumentSql(), [
      ids.tenantA,
      ids.dealOwnedByBde1,
      ids.activityOnDealA,
      "first.pdf",
      path,
      "application/pdf",
      1024,
      ids.bdeA1,
    ]);
    await expect(
      migrator.query(insertDocumentSql(), [
        ids.tenantA,
        ids.dealOwnedByBde1,
        ids.activityOnDealA,
        "second.pdf",
        path,
        "application/pdf",
        1024,
        ids.bdeA1,
      ]),
    ).rejects.toThrow();
  });
});

describe("documents_select: 'inheriting deal visibility' - practice/tenant scope, matching activities_select", () => {
  it("a bde in the deal's own practice can see its documents", async () => {
    const client = await asUser(ids.bdeA1);
    const { rows } = await client.query("select id from documents where deal_id = $1", [ids.dealOwnedByBde1]);
    await client.end();
    expect(rows.length).toBeGreaterThan(0);
  });

  it("a bde in a different practice line cannot see them", async () => {
    const client = await asUser(ids.otherPracticeUser);
    const { rows } = await client.query("select id from documents where deal_id = $1", [ids.dealOwnedByBde1]);
    await client.end();
    expect(rows).toHaveLength(0);
  });

  it("executive sees them tenant-wide, even outside their own practice entitlement", async () => {
    const client = await asUser(ids.execA);
    const { rows } = await client.query("select id from documents where deal_id = $1", [ids.dealOwnedByBde1]);
    await client.end();
    expect(rows.length).toBeGreaterThan(0);
  });

  it("tenant_admin sees them tenant-wide too", async () => {
    const client = await asUser(ids.adminA);
    const { rows } = await client.query("select id from documents where deal_id = $1", [ids.dealOwnedByBde1]);
    await client.end();
    expect(rows.length).toBeGreaterThan(0);
  });

  it("a user in a different tenant cannot see them at all", async () => {
    const client = await asUser(ids.otherTenantUser);
    const { rows } = await client.query("select id from documents where deal_id = $1", [ids.dealOwnedByBde1]);
    await client.end();
    expect(rows).toHaveLength(0);
  });
});

describe("documents_insert: activity.attach_file - own (bde), practice (team_lead/director), tenant (tenant_admin), denied (executive)", () => {
  it("the deal's owning bde can attach a file to an activity on their own deal", async () => {
    const client = await asUser(ids.bdeA1);
    const inserted = await tryInsert(client, insertDocumentSql(), [
      ids.tenantA,
      ids.dealOwnedByBde1,
      ids.activityOnDealA,
      "owner-upload.pdf",
      uniqueStoragePath(),
      "application/pdf",
      2048,
      ids.bdeA1,
    ]);
    await client.end();
    expect(inserted).toBe(true);
  });

  it("a same-practice bde who doesn't own/co-own/author the deal cannot attach a file - 'own' has no practice-wide override for bde", async () => {
    const client = await asUser(ids.bdeA2);
    const inserted = await tryInsert(client, insertDocumentSql(), [
      ids.tenantA,
      ids.dealOwnedByBde1,
      ids.activityOnDealA,
      "peer-upload.pdf",
      uniqueStoragePath(),
      "application/pdf",
      2048,
      ids.bdeA2,
    ]);
    await client.end();
    expect(inserted).toBe(false);
  });

  it("team_lead can attach a file to any deal in their entitled practice", async () => {
    const client = await asUser(ids.teamLeadA);
    const inserted = await tryInsert(client, insertDocumentSql(), [
      ids.tenantA,
      ids.dealOwnedByBde1,
      ids.activityOnDealA,
      "team-lead-upload.pdf",
      uniqueStoragePath(),
      "application/pdf",
      2048,
      ids.teamLeadA,
    ]);
    await client.end();
    expect(inserted).toBe(true);
  });

  it("director can attach a file to any deal in their entitled practice", async () => {
    const client = await asUser(ids.directorA);
    const inserted = await tryInsert(client, insertDocumentSql(), [
      ids.tenantA,
      ids.dealOwnedByBde1,
      ids.activityOnDealA,
      "director-upload.pdf",
      uniqueStoragePath(),
      "application/pdf",
      2048,
      ids.directorA,
    ]);
    await client.end();
    expect(inserted).toBe(true);
  });

  it("tenant_admin can attach a file tenant-wide, even outside their own practice entitlement", async () => {
    const client = await asUser(ids.adminA);
    const inserted = await tryInsert(client, insertDocumentSql(), [
      ids.tenantA,
      ids.dealOwnedByBde1,
      ids.activityOnDealA,
      "admin-upload.pdf",
      uniqueStoragePath(),
      "application/pdf",
      2048,
      ids.adminA,
    ]);
    await client.end();
    expect(inserted).toBe(true);
  });

  it("executive can never attach a file - read-only, enforced in RLS", async () => {
    const client = await asUser(ids.execA);
    const inserted = await tryInsert(client, insertDocumentSql(), [
      ids.tenantA,
      ids.dealOwnedByBde1,
      ids.activityOnDealA,
      "exec-upload.pdf",
      uniqueStoragePath(),
      "application/pdf",
      2048,
      ids.execA,
    ]);
    await client.end();
    expect(inserted).toBe(false);
  });
});

// document.soft_delete has no RLS policy at all in this migration, deliberately - see
// db/migrations/0010_documents.up.sql's own comment for the two reasons: M3.8's scope is upload
// plus view, not removal, and (a genuine finding) Postgres re-validates an UPDATE's resulting row
// against documents_select too, which would make setting deleted_at through a plain UPDATE policy
// impossible to satisfy anyway, since the row must stay `deleted_at is null` to remain selectable.
// A future soft-delete needs a service-role-backed write, retractActivityRow-style, not an RLS
// policy - this suite proves the negative directly instead: no `authenticated` identity, in any
// role, can flip deleted_at via their own session today, exactly because no policy permits it.
describe("documents has no UPDATE policy for `authenticated` yet - deleted_at cannot be set via any role's own session", () => {
  it("not even tenant_admin can update a documents row through their own RLS-scoped session", async () => {
    const { rows } = await migrator.query(insertDocumentSql() + " returning id", [
      ids.tenantA,
      ids.dealOwnedByBde1,
      ids.activityOnDealA,
      "no-update-policy-yet.pdf",
      uniqueStoragePath(),
      "application/pdf",
      2048,
      ids.bdeA1,
    ]);
    const client = await asUser(ids.adminA);
    const result = await client.query("update documents set deleted_at = now() where id = $1", [rows[0].id]);
    await client.end();
    // No UPDATE policy at all means default-deny: the row is simply not matched for update (0 rows
    // affected), the same silent-filtering shape a SELECT with no matching policy has - not a
    // thrown error, since there IS a policy that COULD apply and fail (that throws instead, as the
    // migration's own comment on the just-discovered mechanics describes); here there is none.
    expect(result.rowCount).toBe(0);

    const { rows: unchanged } = await migrator.query("select deleted_at from documents where id = $1", [rows[0].id]);
    expect(unchanged[0].deleted_at).toBeNull();
  });
});

describe("no hard-delete path", () => {
  it("no role, not even tenant_admin, can DELETE a documents row - CLAUDE.md #3 (no DELETE grant exists for `authenticated`, for any table)", async () => {
    const { rows } = await migrator.query(insertDocumentSql() + " returning id", [
      ids.tenantA,
      ids.dealOwnedByBde1,
      ids.activityOnDealA,
      "never-hard-deleted.pdf",
      uniqueStoragePath(),
      "application/pdf",
      2048,
      ids.bdeA1,
    ]);
    const client = await asUser(ids.adminA);
    await expect(client.query("delete from documents where id = $1", [rows[0].id])).rejects.toThrow(/permission denied/);
    await client.end();

    const { rows: stillThere } = await migrator.query("select id from documents where id = $1", [rows[0].id]);
    expect(stillThere).toHaveLength(1);
  });
});
