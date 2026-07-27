import { describe, expect, it } from "vitest";

// Placeholder proving the permission suite runner is wired (M0.1). The real matrix
// completeness test — every role x action pair, allow and deny — lands in M0.4
// against src/auth/permissions.ts per docs/02-permission-matrix.md. This suite must
// never be allowed to report green without asserting a real deny case once that
// file exists.
describe("permission suite scaffold", () => {
  it("runs", () => {
    expect(true).toBe(true);
  });
});
