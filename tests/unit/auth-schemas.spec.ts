import { describe, expect, it } from "vitest";
import { signInSchema } from "../../app/(auth)/sign-in/schema";
import { requestResetSchema } from "../../app/(auth)/reset-password/schema";
import { updatePasswordSchema } from "../../app/(auth)/update-password/schema";

describe("signInSchema", () => {
  it("accepts a valid email and non-empty password", () => {
    const result = signInSchema.safeParse({ email: "user@example.com", password: "hunter2" });
    expect(result.success).toBe(true);
  });

  it("rejects an empty email", () => {
    const result = signInSchema.safeParse({ email: "", password: "hunter2" });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed email", () => {
    const result = signInSchema.safeParse({ email: "not-an-email", password: "hunter2" });
    expect(result.success).toBe(false);
  });

  it("rejects an empty password", () => {
    const result = signInSchema.safeParse({ email: "user@example.com", password: "" });
    expect(result.success).toBe(false);
  });
});

describe("requestResetSchema", () => {
  it("accepts a valid email", () => {
    expect(requestResetSchema.safeParse({ email: "user@example.com" }).success).toBe(true);
  });

  it("rejects a malformed email", () => {
    expect(requestResetSchema.safeParse({ email: "nope" }).success).toBe(false);
  });
});

describe("updatePasswordSchema", () => {
  it("accepts matching passwords at least 8 characters", () => {
    const result = updatePasswordSchema.safeParse({
      password: "longenough1",
      confirmPassword: "longenough1",
    });
    expect(result.success).toBe(true);
  });

  it("rejects passwords shorter than 8 characters", () => {
    const result = updatePasswordSchema.safeParse({ password: "short1", confirmPassword: "short1" });
    expect(result.success).toBe(false);
  });

  it("rejects mismatched passwords", () => {
    const result = updatePasswordSchema.safeParse({
      password: "longenough1",
      confirmPassword: "different1",
    });
    expect(result.success).toBe(false);
  });
});
