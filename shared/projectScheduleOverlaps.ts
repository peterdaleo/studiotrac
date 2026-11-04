export type ScheduleProject = {
  id: number;
  name: string;
  startDate: Date | string | null;
  deadline: Date | string | null;
};

export type ScheduleTask = {
  projectId: number;
  assigneeId: number | null;
};

export type ScheduleMember = {
  id: number;
  name: string;
};

export type ProjectScheduleOverlap = {
  memberId: number;
  memberName: string;
  projectA: { id: number; name: string };
  projectB: { id: number; name: string };
  overlapStart: Date;
  overlapEnd: Date;
};

type ProjectWindow = {
  id: number;
  name: string;
  start: Date;
  end: Date;
};

function validDate(value: Date | string | null): Date | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Find shared-assignee pairs whose project-level date ranges overlap.
 * This deliberately uses project start/deadline dates, not task dates or capacity.
 */
export function findProjectScheduleOverlaps(
  projects: readonly ScheduleProject[],
  tasks: readonly ScheduleTask[],
  members: readonly ScheduleMember[],
): ProjectScheduleOverlap[] {
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const memberProjects = new Map<number, Map<number, ProjectWindow>>();

  for (const task of tasks) {
    if (task.assigneeId == null) continue;
    const project = projectById.get(task.projectId);
    if (!project) continue;
    const start = validDate(project.startDate);
    const end = validDate(project.deadline);
    if (!start || !end || start.getTime() > end.getTime()) continue;

    let assignments = memberProjects.get(task.assigneeId);
    if (!assignments) {
      assignments = new Map<number, ProjectWindow>();
      memberProjects.set(task.assigneeId, assignments);
    }
    if (!assignments.has(project.id)) {
      assignments.set(project.id, { id: project.id, name: project.name, start, end });
    }
  }

  const memberNames = new Map(members.map((member) => [member.id, member.name]));
  const overlaps: ProjectScheduleOverlap[] = [];
  Array.from(memberProjects.entries()).forEach(([memberId, assignmentsByProject]) => {
    const assignments = Array.from(assignmentsByProject.values());
    for (let i = 0; i < assignments.length; i++) {
      for (let j = i + 1; j < assignments.length; j++) {
        const projectA = assignments[i]!;
        const projectB = assignments[j]!;
        const overlapStart = Math.max(projectA.start.getTime(), projectB.start.getTime());
        const overlapEnd = Math.min(projectA.end.getTime(), projectB.end.getTime());
        if (overlapStart > overlapEnd) continue;
        overlaps.push({
          memberId,
          memberName: memberNames.get(memberId) ?? "Team member",
          projectA: { id: projectA.id, name: projectA.name },
          projectB: { id: projectB.id, name: projectB.name },
          overlapStart: new Date(overlapStart),
          overlapEnd: new Date(overlapEnd),
        });
      }
    }
  });
  return overlaps;
}
