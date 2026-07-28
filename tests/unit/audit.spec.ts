import { describe, expect, it, vi } from "vitest";
import { writeAudit } from "../../src/services/audit";

function makeServiceClient(returnedRow: Record<string, unknown>) {
  const single = vi.fn().mockResolvedValue({ data: returnedRow, error: null });
  const select = vi.fn().mockReturnValue({ single });
  const insert = vi.fn().mockReturnValue({ select });
  const from = vi.fn().mockReturnValue({ insert });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from, _insert: insert } as any;
}

const BASE_ROW = {
  id: 1,
  tenant_id: "tenant-1",
  actor_id: "user-1",
  entity_type: "deal",
  entity_id: "deal-1",
  action: "deal.create",
  before: null,
  after: { name: "New deal" },
  ip_hash: null,
  occurred_at: "2026-01-01T00:00:00Z",
};

describe("writeAudit", () => {
  it("inserts into audit_entries via the service client and maps the row back to domain shape", async () => {
    const client = makeServiceClient(BASE_ROW);
    const result = await writeAudit(
      {
        tenantId: "tenant-1",
        actorId: "user-1",
        entityType: "deal",
        entityId: "deal-1",
        action: "deal.create",
        after: { name: "New deal" },
      },
      client,
    );

    expect(client.from).toHaveBeenCalledWith("audit_entries");
    expect(result).toEqual({
      id: "1",
      tenantId: "tenant-1",
      actorId: "user-1",
      entityType: "deal",
      entityId: "deal-1",
      action: "deal.create",
      before: null,
      after: { name: "New deal" },
      ipHash: null,
      occurredAt: "2026-01-01T00:00:00Z",
    });
  });

  it("hashes the IP address before it ever reaches the insert - never stores it raw", async () => {
    const client = makeServiceClient({ ...BASE_ROW, ip_hash: "irrelevant-for-this-assertion" });
    await writeAudit(
      {
        tenantId: "tenant-1",
        actorId: "user-1",
        entityType: "deal",
        entityId: "deal-1",
        action: "deal.create",
        ipAddress: "203.0.113.42",
      },
      client,
    );

    const insertedRow = client._insert.mock.calls[0][0];
    expect(insertedRow.ip_hash).not.toBe("203.0.113.42");
    expect(insertedRow.ip_hash).toMatch(/^[a-f0-9]{64}$/); // sha256 hex digest, not the raw address
  });

  it("stores a null ip_hash when no IP address is given, rather than hashing an empty string", async () => {
    const client = makeServiceClient(BASE_ROW);
    await writeAudit(
      { tenantId: "tenant-1", actorId: "user-1", entityType: "deal", entityId: "deal-1", action: "deal.create" },
      client,
    );

    const insertedRow = client._insert.mock.calls[0][0];
    expect(insertedRow.ip_hash).toBeNull();
  });
});
