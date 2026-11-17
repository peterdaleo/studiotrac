import { describe, expect, it } from "vitest";
import { canPmSelfAssignUnassignedTask } from "./taskAssignmentAuthorization";

const validSelfAssignment = {
  role: "pm" as const,
  currentAssigneeId: null,
  requestedAssigneeId: 42,
  actorTeamMemberId: 42,
  projectManagerId: 42,
};

describe("PM unassigned-task self-assignment policy", () => {
  it("allows the PM assigned to the project to assign the task to their own team-member ID", () => {
    expect(canPmSelfAssignUnassignedTask(validSelfAssignment)).toBe(true);
  });

  it.each([
    ["non-PM role", { role: "user" as const }],
    ["already assigned task", { currentAssigneeId: 7 }],
    ["different assignee", { requestedAssigneeId: 7 }],
    ["PM not assigned to this project", { projectManagerId: 7 }],
    ["missing linked team member", { actorTeamMemberId: null }],
    ["no requested assignee", { requestedAssigneeId: null }],
  ])("denies %s", (_reason, overrides) => {
    expect(canPmSelfAssignUnassignedTask({ ...validSelfAssignment, ...overrides })).toBe(false);
  });
});
