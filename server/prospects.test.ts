import { describe, expect, it } from "vitest";
import { escapeCsvCell, getFollowUpStatus, prospectDateInRange } from "../shared/prospects";
import { appRouter } from "./routers";

describe("prospect follow-up status", () => {
  const today = new Date(2026, 9, 15, 12, 0, 0);

  it("marks a past follow-up as overdue", () => {
    expect(getFollowUpStatus("2026-10-14", "Contacted", today)).toBe("overdue");
  });

  it("marks a follow-up on the local calendar day as due today", () => {
    expect(getFollowUpStatus("2026-10-15", "Proposal", today)).toBe("today");
  });

  it("keeps future follow-ups and missing dates distinct", () => {
    expect(getFollowUpStatus("2026-10-16", "New", today)).toBe("upcoming");
    expect(getFollowUpStatus(null, "New", today)).toBe("none");
  });

  it("does not show follow-ups for Won or Lost prospects", () => {
    expect(getFollowUpStatus("2026-10-14", "Won", today)).toBe("closed");
    expect(getFollowUpStatus("2026-10-15", "Lost", today)).toBe("closed");
  });
});

describe("prospect date range", () => {
  it("includes dates within inclusive bounds", () => {
    expect(prospectDateInRange("2026-10-15", "2026-10-15", "2026-10-15")).toBe(true);
    expect(prospectDateInRange("2026-10-14", "2026-10-15", undefined)).toBe(false);
  });

  it("excludes missing dates when a bound is active", () => {
    expect(prospectDateInRange(null, "2026-10-01", undefined)).toBe(false);
    expect(prospectDateInRange(null)).toBe(true);
  });
});

describe("prospect CSV escaping", () => {
  it("quotes commas and embedded quotes", () => {
    expect(escapeCsvCell('Architects, "Inc."')).toBe('"Architects, ""Inc."""');
  });

  it("neutralizes formula-like user text", () => {
    expect(escapeCsvCell("=SUM(A1:A2)")).toBe("\"'=SUM(A1:A2)\"");
  });
});

describe("prospect API access", () => {
  it.each(["admin", "pm"])("rejects a %s without an organization workspace", async (role) => {
    const caller = appRouter.createCaller({
      req: {} as any,
      res: {} as any,
      user: { id: 10, role, organizationId: null } as any,
      organizationId: null,
    });
    await expect(caller.prospects.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects staff even when they belong to an organization", async () => {
    const caller = appRouter.createCaller({
      req: {} as any,
      res: {} as any,
      user: { id: 11, role: "user", organizationId: 42 } as any,
      organizationId: 42,
    });
    await expect(caller.prospects.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
