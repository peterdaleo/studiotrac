import { describe, expect, it } from "vitest";
import { canManageBilling } from "../shared/billingAccess";

describe("firm-owner-only Billing policy", () => {
  it("allows an explicitly assigned owner in a valid organization", () => {
    expect(canManageBilling({ organizationId: 11, orgRole: "owner" })).toBe(true);
  });

  it.each(["admin", "member", "user", "pm", "", null, undefined])(
    "does not infer ownership from the non-owner organization role %s",
    (orgRole) => {
      expect(canManageBilling({ organizationId: 11, orgRole })).toBe(false);
    },
  );

  it.each([null, undefined, 0, -1, NaN, Infinity, 1.5])(
    "rejects an owner without a valid organization (%s)",
    (organizationId) => {
      expect(canManageBilling({ organizationId, orgRole: "owner" })).toBe(false);
    },
  );

  it("rejects anonymous access", () => {
    expect(canManageBilling(null)).toBe(false);
    expect(canManageBilling(undefined)).toBe(false);
  });

  it("does not substitute application admin or platform-admin privileges for ownership", () => {
    const administrator = { organizationId: 11, orgRole: "admin", role: "admin", isSuperAdmin: true };
    expect(canManageBilling(administrator)).toBe(false);
  });
});
