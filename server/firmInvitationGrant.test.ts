import { describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import {
  createFirmInvitationToken,
  decodeFirmInvitationGrant,
  hashFirmInvitationToken,
  isSupportedFirmInvitationToken,
} from "./firmInvitationGrant";

describe("firm invitation grants", () => {
  it("creates versioned plan-bound tokens with 32 random bytes", () => {
    for (const plan of ["starter", "professional", "enterprise"] as const) {
      const token = createFirmInvitationToken(plan);
      expect(token).toMatch(new RegExp(`^c1\\.${plan}\\.[A-Za-z0-9_-]{43}$`));
      expect(Buffer.from(token.split(".")[2], "base64url")).toHaveLength(32);
      expect(decodeFirmInvitationGrant(token)).toEqual({ complimentaryPlan: plan, activation: "active" });
    }
    expect(createFirmInvitationToken("starter")).not.toBe(createFirmInvitationToken("starter"));
  });

  it("recognizes historical randomBytes(32) tokens as pending with no plan", () => {
    const legacy = randomBytes(32).toString("base64url");
    expect(isSupportedFirmInvitationToken(legacy)).toBe(true);
    expect(decodeFirmInvitationGrant(legacy)).toEqual({ complimentaryPlan: null, activation: "pending" });
  });

  it("fails closed for unknown versions, plans, malformed entropy, and tampered tokens", () => {
    const token = createFirmInvitationToken("professional");
    const entropy = token.split(".")[2];
    for (const unsupported of [
      `c2.professional.${entropy}`,
      `c1.unknown.${entropy}`,
      `c1.starter.${entropy.slice(1)}`,
      `c1.professional.${entropy.slice(0, -1)}!`,
    ]) {
      expect(isSupportedFirmInvitationToken(unsupported)).toBe(false);
      expect(decodeFirmInvitationGrant(unsupported)).toBeNull();
    }
    const changedPlanToken = token.replace("professional", "enterprise");
    expect(hashFirmInvitationToken(changedPlanToken)).not.toBe(hashFirmInvitationToken(token));
    expect(decodeFirmInvitationGrant(changedPlanToken)).toEqual({ complimentaryPlan: "enterprise", activation: "active" });
  });

  it("validates a supplied plan at the store boundary before any database access", async () => {
    const { issueFirmOwnerInvitation } = await vi.importActual<typeof import("./platformAccessStore")>("./platformAccessStore");
    const common = { email: "owner@example.test", firmName: "Example", actorUserId: 1, origin: "https://example.test" };
    await expect(issueFirmOwnerInvitation({ ...common, complimentaryPlan: "invalid" as any })).rejects.toThrow("INVALID_COMPLIMENTARY_PLAN");
    await expect(issueFirmOwnerInvitation({ ...common, complimentaryPlan: null as any })).rejects.toThrow("INVALID_COMPLIMENTARY_PLAN");
  });
});
