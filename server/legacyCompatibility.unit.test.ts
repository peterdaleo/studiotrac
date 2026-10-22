import { describe, expect, it } from "vitest";
import {
  buildEmailPreferenceInsertValues,
  buildEmailPreferenceUpdateValues,
  filterProjectFileRows,
} from "./db";

describe("legacy-compatible email preference persistence", () => {
  it("does not persist unsupported recipients or weeklyDigest from insert payloads", () => {
    const values = buildEmailPreferenceInsertValues(17, {
      deadlineAlerts: false,
      overdueAlerts: true,
      statusChangeAlerts: false,
      alertDaysBefore: 5,
      emailAddress: "recipient@example.test",
      weeklyDigest: true,
    } as any);

    expect(values).toEqual({
      userId: 17,
      deadlineAlerts: false,
      overdueAlerts: true,
      statusChangeAlerts: false,
      alertDaysBefore: 5,
    });
    expect(values).not.toHaveProperty("emailAddress");
    expect(values).not.toHaveProperty("weeklyDigest");
  });

  it("updates only supplied supported flags, leaving a stored weeklyDigest untouched", () => {
    const existing = { userId: 17, deadlineAlerts: true, overdueAlerts: true, weeklyDigest: true };
    const changes = buildEmailPreferenceUpdateValues({
      overdueAlerts: false,
      emailAddress: "must-not-persist@example.test",
      weeklyDigest: false,
    } as any);

    expect(changes).toEqual({ overdueAlerts: false });
    expect({ ...existing, ...changes }.weeklyDigest).toBe(true);
    expect(changes).not.toHaveProperty("emailAddress");
    expect(changes).not.toHaveProperty("weeklyDigest");
  });
});

describe("project file visibility and URL filtering", () => {
  const files = [
    { id: 1, organizationId: 17, isClientVisible: true, url: "/uploads/projects/1/files/a.pdf" },
    { id: 2, organizationId: null, isClientVisible: true, url: "/uploads/projects/1/files/legacy.pdf" },
    { id: 3, organizationId: 17, isClientVisible: false, url: "/uploads/projects/1/files/private.pdf" },
    { id: 4, organizationId: 18, isClientVisible: true, url: "/uploads/projects/1/files/contradictory.pdf" },
    { id: 5, organizationId: 17, isClientVisible: true, url: "https://example.test/public.pdf" },
    { id: 6, organizationId: 17, isClientVisible: true, url: "/uploads/projects/1/files/a.pdf?download=1" },
  ];

  it("returns only visible, same-project-tenant-compatible files with canonical local URLs for clients", () => {
    expect(filterProjectFileRows(files, 17, true).map(file => file.id)).toEqual([1, 2]);
  });

  it("fails closed on contradictory organizations and unknown URLs for authenticated lists too", () => {
    expect(filterProjectFileRows(files, 17).map(file => file.id)).toEqual([1, 2, 3]);
  });
});
