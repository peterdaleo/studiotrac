import { describe, expect, it } from "vitest";
import { findProjectScheduleOverlaps } from "../shared/projectScheduleOverlaps";

describe("project schedule overlap details", () => {
  const members = [{ id: 7, name: "Alex Rivera" }];

  it("returns the shared assignee, project pair, and exact overlapping dates", () => {
    const overlaps = findProjectScheduleOverlaps(
      [
        { id: 1, name: "North Studio", startDate: "2026-03-01T00:00:00.000Z", deadline: "2026-03-12T00:00:00.000Z" },
        { id: 2, name: "Lakeside House", startDate: "2026-03-08T00:00:00.000Z", deadline: "2026-03-19T00:00:00.000Z" },
      ],
      [{ projectId: 1, assigneeId: 7 }, { projectId: 2, assigneeId: 7 }],
      members,
    );

    expect(overlaps).toEqual([{
      memberId: 7,
      memberName: "Alex Rivera",
      projectA: { id: 1, name: "North Studio" },
      projectB: { id: 2, name: "Lakeside House" },
      overlapStart: new Date("2026-03-08T00:00:00.000Z"),
      overlapEnd: new Date("2026-03-12T00:00:00.000Z"),
    }]);
  });

  it("treats a shared endpoint as an overlap and excludes disjoint date ranges", () => {
    const overlaps = findProjectScheduleOverlaps(
      [
        { id: 1, name: "First", startDate: "2026-03-01", deadline: "2026-03-05" },
        { id: 2, name: "Touches", startDate: "2026-03-05", deadline: "2026-03-08" },
        { id: 3, name: "Later", startDate: "2026-03-09", deadline: "2026-03-10" },
      ],
      [1, 2, 3].map((projectId) => ({ projectId, assigneeId: 7 })),
      members,
    );

    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]).toMatchObject({
      projectA: { id: 1, name: "First" },
      projectB: { id: 2, name: "Touches" },
    });
    expect(overlaps[0]?.overlapStart.getTime()).toBe(overlaps[0]?.overlapEnd.getTime());
  });

  it("does not compare tasks within the same project and skips unassigned or undated projects", () => {
    const overlaps = findProjectScheduleOverlaps(
      [
        { id: 1, name: "Dated", startDate: "2026-03-01", deadline: "2026-03-10" },
        { id: 2, name: "Undated", startDate: null, deadline: "2026-03-10" },
      ],
      [
        { projectId: 1, assigneeId: 7 },
        { projectId: 1, assigneeId: 7 },
        { projectId: 2, assigneeId: 7 },
        { projectId: 2, assigneeId: null },
      ],
      members,
    );

    expect(overlaps).toEqual([]);
  });

  it("uses a clear fallback when an assignee is missing from the member list", () => {
    const overlaps = findProjectScheduleOverlaps(
      [
        { id: 1, name: "First", startDate: "2026-03-01", deadline: "2026-03-10" },
        { id: 2, name: "Second", startDate: "2026-03-05", deadline: "2026-03-15" },
      ],
      [{ projectId: 1, assigneeId: 99 }, { projectId: 2, assigneeId: 99 }],
      [],
    );

    expect(overlaps[0]?.memberName).toBe("Team member");
  });
});
