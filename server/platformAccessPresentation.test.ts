import { describe, expect, it } from "vitest";
import { getArchivedOrganizationIds, getFirmInvitationStatus, partitionFirmInvitations } from "../shared/platformAccessPresentation";

const now = Date.parse("2026-10-23T12:00:00.000Z");
const invite = (id: number, overrides: Partial<{ acceptedAt: Date | string | null; revokedAt: Date | string | null; expiresAt: Date | string }> = {}) => ({
  id,
  acceptedAt: null as Date | string | null,
  revokedAt: null as Date | string | null,
  expiresAt: "2026-10-24T12:00:00.000Z",
  ...overrides,
});

describe("firm invitation history presentation", () => {
  it("classifies accepted and revoked records before checking expiry", () => {
    expect(getFirmInvitationStatus(invite(1, { acceptedAt: "2026-10-22T12:00:00.000Z", expiresAt: "2026-10-20T12:00:00.000Z" }), now)).toBe("Accepted");
    expect(getFirmInvitationStatus(invite(2, { revokedAt: "2026-10-22T12:00:00.000Z", expiresAt: "2026-10-20T12:00:00.000Z" }), now)).toBe("Revoked");
    expect(getFirmInvitationStatus(invite(3, { expiresAt: "2026-10-20T12:00:00.000Z" }), now)).toBe("Expired");
    expect(getFirmInvitationStatus(invite(4), now)).toBe("Pending");
  });

  it("moves only terminal records to history and preserves all records and their order", () => {
    const records = [
      invite(1),
      invite(2, { acceptedAt: "2026-10-22T12:00:00.000Z" }),
      invite(3, { revokedAt: "2026-10-22T12:00:00.000Z" }),
      invite(4, { expiresAt: "2026-10-20T12:00:00.000Z" }),
      invite(5),
    ];

    const result = partitionFirmInvitations(records, now);

    expect(result.current.map((record) => record.id)).toEqual([1, 5]);
    expect(result.history.map((record) => record.id)).toEqual([2, 3, 4]);
    expect([...result.current, ...result.history].map((record) => record.id).sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("uses the latest archive transition without treating unrelated audit rows as state", () => {
    const archived = getArchivedOrganizationIds([
      { organizationId: 7, action: "workspace_unarchived" },
      { organizationId: 8, action: "workspace_archived" },
      { organizationId: 7, action: "workspace_archived" },
      { organizationId: 8, action: "complimentary_plan_granted" },
      { organizationId: null, action: "workspace_archived" },
    ]);

    expect(archived.has(7)).toBe(false);
    expect(archived.has(8)).toBe(true);
    expect(archived.size).toBe(1);
  });
});
