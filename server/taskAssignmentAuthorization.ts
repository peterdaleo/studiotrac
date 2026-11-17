type TaskAssignmentRole = "admin" | "pm" | "user";

export function canPmSelfAssignUnassignedTask(input: {
  role: TaskAssignmentRole;
  currentAssigneeId: number | null;
  requestedAssigneeId: number | null | undefined;
  actorTeamMemberId: number | null;
  projectManagerId: number | null;
}): boolean {
  return input.role === "pm" &&
    input.currentAssigneeId === null &&
    input.actorTeamMemberId !== null &&
    input.projectManagerId === input.actorTeamMemberId &&
    input.requestedAssigneeId === input.actorTeamMemberId;
}
