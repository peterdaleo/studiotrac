import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, ChevronLeft, ChevronRight, AlertTriangle, Calendar, Users } from "lucide-react";
import { useState, useMemo, useRef } from "react";
import { useLocation } from "wouter";
import { getPhaseLabel } from "@shared/constants";
import { findProjectScheduleOverlaps, type ProjectScheduleOverlap } from "@shared/projectScheduleOverlaps";

function formatOverlapRange(overlap: ProjectScheduleOverlap): string {
  const format = (date: Date) => date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return overlap.overlapStart.toDateString() === overlap.overlapEnd.toDateString()
    ? format(overlap.overlapStart)
    : `${format(overlap.overlapStart)} – ${format(overlap.overlapEnd)}`;
}

const STATUS_BADGE_COLORS: Record<string, string> = {
  on_track: "bg-emerald-100 text-emerald-800 border-emerald-200",
  on_hold: "bg-amber-100 text-amber-800 border-amber-200",
  delayed: "bg-red-100 text-red-800 border-red-200",
  completed: "bg-slate-100 text-slate-600 border-slate-200",
};

const PHASE_COLORS: Record<string, string> = {
  pre_design: "#818cf8",
  schematic_design: "#6366f1",
  design_development: "#4f46e5",
  construction_documents: "#4338ca",
  bidding_negotiation: "#3730a3",
  construction_administration: "#312e81",
  post_occupancy: "#1e1b4b",
};

export default function Timeline() {
  const { data: ganttData, isLoading } = trpc.gantt.data.useQuery();
  const [, navigate] = useLocation();
  const [monthOffset, setMonthOffset] = useState(0);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [groupBy, setGroupBy] = useState<"project" | "member">("project");
  const scrollRef = useRef<HTMLDivElement>(null);

  const today = useMemo(() => new Date(), []);

  // Calculate visible date range (6 months window)
  const { startDate, endDate, months } = useMemo(() => {
    const start = new Date(today.getFullYear(), today.getMonth() + monthOffset - 1, 1);
    const end = new Date(today.getFullYear(), today.getMonth() + monthOffset + 5, 0);
    const monthList: { label: string; start: Date; end: Date; days: number }[] = [];
    for (let m = 0; m < 6; m++) {
      const mStart = new Date(start.getFullYear(), start.getMonth() + m, 1);
      const mEnd = new Date(start.getFullYear(), start.getMonth() + m + 1, 0);
      monthList.push({
        label: mStart.toLocaleDateString("en-US", { month: "short", year: "numeric" }),
        start: mStart,
        end: mEnd,
        days: mEnd.getDate(),
      });
    }
    return { startDate: start, endDate: end, months: monthList };
  }, [today, monthOffset]);

  const totalDays = useMemo(() => {
    return Math.ceil((endDate.getTime() - startDate.getTime()) / 86400000) + 1;
  }, [startDate, endDate]);

  const filteredProjects = useMemo(() => {
    if (!ganttData?.projects) return [];
    let p = ganttData.projects;
    if (filterStatus !== "all") p = p.filter(proj => proj.status === filterStatus);
    return p;
  }, [ganttData, filterStatus]);

  // This is an indicator based on project date ranges, not task dates or team capacity.
  const conflicts = useMemo(() => {
    if (!ganttData) return [];
    return findProjectScheduleOverlaps(ganttData.projects, ganttData.tasks, ganttData.members);
  }, [ganttData]);

  const getBarPosition = (projStart: Date | null, projEnd: Date | null) => {
    if (!projStart || !projEnd) return null;
    const s = new Date(projStart);
    const e = new Date(projEnd);
    const leftDays = Math.max(0, (s.getTime() - startDate.getTime()) / 86400000);
    const rightDays = Math.min(totalDays, (e.getTime() - startDate.getTime()) / 86400000);
    if (rightDays < 0 || leftDays > totalDays) return null;
    const left = (Math.max(0, leftDays) / totalDays) * 100;
    const width = ((rightDays - Math.max(0, leftDays)) / totalDays) * 100;
    return { left: `${left}%`, width: `${Math.max(width, 0.5)}%` };
  };

  const getOverlapPosition = (overlapStart: Date, overlapEnd: Date) => {
    const localDayIndex = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000;
    const windowStart = localDayIndex(startDate);
    const leftDay = Math.max(windowStart, localDayIndex(overlapStart));
    const rightDay = Math.min(windowStart + totalDays, localDayIndex(overlapEnd) + 1);
    if (rightDay <= leftDay) return null;
    return { left: `${((leftDay - windowStart) / totalDays) * 100}%`, width: `${((rightDay - leftDay) / totalDays) * 100}%` };
  };

  const todayPosition = useMemo(() => {
    const daysSinceStart = (today.getTime() - startDate.getTime()) / 86400000;
    if (daysSinceStart < 0 || daysSinceStart > totalDays) return null;
    return `${(daysSinceStart / totalDays) * 100}%`;
  }, [today, startDate, totalDays]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Timeline</h1>
          <p className="text-muted-foreground">Project schedules and resource allocation</p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={groupBy} onValueChange={(v: any) => setGroupBy(v)}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Group by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="project">Group by: Project</SelectItem>
              <SelectItem value="member">Group by: Team Member</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Filter status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Projects</SelectItem>
              <SelectItem value="on_track">On Track</SelectItem>
              <SelectItem value="delayed">Delayed</SelectItem>
              <SelectItem value="on_hold">On Hold</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Conflict Alert */}
      {conflicts.length > 0 && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="py-3 px-4 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-amber-800">
                Potential schedule overlap
              </p>
              <p className="mt-1 text-xs text-amber-700">
                {conflicts.length} overlapping assignment pair{conflicts.length === 1 ? "" : "s"}. This checks project start/end dates for people assigned to tasks in both projects; it does not compare task dates or team capacity.
              </p>
              <ul className="mt-2 max-h-36 space-y-1 overflow-y-auto text-xs text-amber-950">
                {conflicts.map((overlap) => (
                  <li key={`${overlap.memberId}-${overlap.projectA.id}-${overlap.projectB.id}`} className="flex flex-wrap gap-x-1">
                    <span className="font-semibold">{overlap.memberName}:</span>
                    <span>{overlap.projectA.name} + {overlap.projectB.name}</span>
                    <span className="text-amber-800">({formatOverlapRange(overlap)})</span>
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Timeline Chart */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Gantt Chart
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" onClick={() => setMonthOffset(o => o - 2)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => setMonthOffset(0)}>
                Today
              </Button>
              <Button variant="outline" size="icon" onClick={() => setMonthOffset(o => o + 2)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto" ref={scrollRef}>
            <div className="min-w-[800px]">
              {/* Month Headers */}
              <div className="flex border-b border-border">
                <div className="w-[260px] shrink-0 px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider border-r border-border">
                  {groupBy === "project" ? "Project" : "Team Member"}
                </div>
                <div className="flex-1 flex relative">
                  {months.map((month, i) => (
                    <div
                      key={i}
                      className="flex-1 text-center py-2 text-xs font-medium text-muted-foreground border-r border-border last:border-r-0"
                    >
                      {month.label}
                    </div>
                  ))}
                </div>
              </div>

              {/* Member Rows (Group by Team Member) */}
              {groupBy === "member" && (() => {
                if (!ganttData?.members || ganttData.members.length === 0) {
                  return <div className="py-12 text-center text-muted-foreground">No team members to display</div>;
                }
                return ganttData.members.map(member => {
                  // Find all projects this member is assigned to (via tasks)
                  const memberTasks = ganttData.tasks.filter(t => t.assigneeId === member.id);
                  const projectMap = new Map<number, { project: typeof ganttData.projects[0]; firstAssigned: Date; lastDeadline: Date | null }>();
                  for (const task of memberTasks) {
                    const project = ganttData.projects.find(p => p.id === task.projectId);
                    if (!project) continue;
                    if (filterStatus !== "all" && project.status !== filterStatus) continue;
                    const existing = projectMap.get(project.id);
                    const taskStart = new Date(task.startDate ?? task.createdAt);
                    const taskDeadline = task.deadline ? new Date(task.deadline) : null;
                    if (!existing) {
                      projectMap.set(project.id, { project, firstAssigned: taskStart, lastDeadline: taskDeadline });
                    } else {
                      if (taskStart < existing.firstAssigned) existing.firstAssigned = taskStart;
                      if (taskDeadline && (!existing.lastDeadline || taskDeadline > existing.lastDeadline)) existing.lastDeadline = taskDeadline;
                    }
                  }
                  const projectBars = Array.from(projectMap.values());
                  const memberOverlaps = conflicts.filter((overlap) => overlap.memberId === member.id);
                  if (projectBars.length === 0) return null;
                  return (
                    <div key={member.id}>
                      {/* Member row */}
                      <div className="flex border-b border-border/50 bg-muted/20">
                        <div className="w-[260px] shrink-0 px-3 py-3 border-r border-border">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-semibold shrink-0" style={{ backgroundColor: member.avatarColor || "#6366f1" }}>
                              {member.name.charAt(0)}
                            </div>
                            <div className="min-w-0">
                              <span className="text-sm font-medium truncate block">{member.name}</span>
                              <span className="text-[10px] text-muted-foreground">{projectBars.length} project(s)</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex-1 relative py-3">
                          <div className="absolute inset-0 flex pointer-events-none">
                            {months.map((_, i) => <div key={i} className="flex-1 border-r border-border/30 last:border-r-0" />)}
                          </div>
                          {memberOverlaps.map((overlap) => {
                            const position = getOverlapPosition(overlap.overlapStart, overlap.overlapEnd);
                            if (!position) return null;
                            return (
                              <Tooltip key={`${overlap.memberId}-${overlap.projectA.id}-${overlap.projectB.id}`}>
                                <TooltipTrigger asChild>
                                  <div aria-label={`Potential schedule overlap: ${overlap.projectA.name} and ${overlap.projectB.name}, ${formatOverlapRange(overlap)}`} className="absolute inset-y-0 z-0 border-x-2 border-amber-500/90 bg-amber-300/40" style={position} />
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p className="text-xs font-medium">Potential schedule overlap · {member.name}</p>
                                  <p className="text-xs">{overlap.projectA.name} + {overlap.projectB.name}</p>
                                  <p className="text-xs text-muted-foreground">{formatOverlapRange(overlap)}</p>
                                </TooltipContent>
                              </Tooltip>
                            );
                          })}
                          {todayPosition && <div className="absolute top-0 bottom-0 w-px bg-red-400 z-10 pointer-events-none" style={{ left: todayPosition }} />}
                        </div>
                      </div>
                      {/* Project sub-bars for this member */}
                      {projectBars.map(({ project, firstAssigned, lastDeadline }) => {
                        const projEnd = lastDeadline || (project.deadline ? new Date(project.deadline) : null);
                        const bar = getBarPosition(firstAssigned, projEnd);
                        if (!bar) return null;
                        const phaseColor = PHASE_COLORS[project.phase] || "#6366f1";
                        return (
                          <div key={`${member.id}-${project.id}`} className="flex border-b border-border/20 hover:bg-muted/30 cursor-pointer" onClick={() => navigate(`/projects/${project.id}`)}>
                            <div className="w-[260px] shrink-0 px-3 py-1.5 border-r border-border pl-10">
                              <span className="text-[11px] text-muted-foreground truncate block">{project.name}</span>
                            </div>
                            <div className="flex-1 relative py-1.5">
                              <div className="absolute inset-0 flex pointer-events-none">
                                {months.map((_, i) => <div key={i} className="flex-1 border-r border-border/20 last:border-r-0" />)}
                              </div>
                              {todayPosition && <div className="absolute top-0 bottom-0 w-px bg-red-400/40 z-10 pointer-events-none" style={{ left: todayPosition }} />}
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div className="absolute top-1/2 -translate-y-1/2 h-4 rounded-sm" style={{ left: bar.left, width: bar.width, backgroundColor: phaseColor, opacity: 0.7 }} />
                                </TooltipTrigger>
                                <TooltipContent side="top">
                                  <p className="text-xs font-medium">{project.name}</p>
                                  <p className="text-xs text-muted-foreground">First task start: {firstAssigned.toLocaleDateString()}{projEnd && ` — Last deadline: ${projEnd.toLocaleDateString()}`}</p>
                                </TooltipContent>
                              </Tooltip>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                });
              })()}

              {/* Project Rows (Group by Project) */}
              {groupBy === "project" && (filteredProjects.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground">
                  No projects to display in this view
                </div>
              ) : (
                filteredProjects.map((project) => {
                  const bar = getBarPosition(project.startDate, project.deadline);
                  const projectOverlaps = conflicts.filter((overlap) => overlap.projectA.id === project.id || overlap.projectB.id === project.id);
                  const hasConflict = projectOverlaps.length > 0;
                  const taskCount = ganttData?.tasks.filter(t => t.projectId === project.id).length ?? 0;
                  const phaseColor = PHASE_COLORS[project.phase] || "#6366f1";

                  // Build per-member sub-bars for this project
                  const projectTasks = ganttData?.tasks.filter(t => t.projectId === project.id) ?? [];
                  const memberMap = new Map<number, { member: NonNullable<typeof ganttData>["members"][number]; firstAssigned: Date; lastDeadline: Date | null }>();
                  for (const task of projectTasks) {
                    if (!task.assigneeId) continue;
                    const existing = memberMap.get(task.assigneeId);
                    const taskStart = new Date(task.startDate ?? task.createdAt);
                    const taskDeadline = task.deadline ? new Date(task.deadline) : null;
                    if (!existing) {
                      const member = ganttData?.members.find(m => m.id === task.assigneeId);
                      if (member) {
                        memberMap.set(task.assigneeId, {
                          member,
                          firstAssigned: taskStart,
                          lastDeadline: taskDeadline,
                        });
                      }
                    } else {
                      if (taskStart < existing.firstAssigned) existing.firstAssigned = taskStart;
                      if (taskDeadline && (!existing.lastDeadline || taskDeadline > existing.lastDeadline)) existing.lastDeadline = taskDeadline;
                    }
                  }
                  const memberBars = Array.from(memberMap.values());

                  return (
                    <div key={project.id}>
                      {/* Project row */}
                      <div
                        className="flex border-b border-border/50 hover:bg-muted/30 transition-colors group cursor-pointer"
                        onClick={() => navigate(`/projects/${project.id}`)}
                      >
                        {/* Project Info */}
                        <div className="w-[260px] shrink-0 px-3 py-3 border-r border-border">
                          <div className="flex items-start gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium truncate">{project.name}</span>
                                {hasConflict && (
                                  <Tooltip>
                                    <TooltipTrigger>
                                      <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                                    </TooltipTrigger>
                                    <TooltipContent>Potential schedule overlap. See the highlighted interval and details above.</TooltipContent>
                                  </Tooltip>
                                )}
                              </div>
                              <div className="flex items-center gap-2 mt-1">
                                <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${project.completionPercentage >= 100 ? "bg-purple-500/10 text-purple-700 border-purple-200" : STATUS_BADGE_COLORS[project.status] || ""}`}>
                                  {project.completionPercentage >= 100 ? "Pending Closeout" : project.status.replace("_", " ")}
                                </Badge>
                                <span className="text-[10px] text-muted-foreground">
                                  {getPhaseLabel(project.phase)}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Gantt Bar */}
                        <div className="flex-1 relative py-3">
                          {/* Grid lines for months */}
                          <div className="absolute inset-0 flex pointer-events-none">
                            {months.map((_, i) => (
                              <div key={i} className="flex-1 border-r border-border/30 last:border-r-0" />
                            ))}
                          </div>

                          {/* Today line */}
                          {todayPosition && (
                            <div
                              className="absolute top-0 bottom-0 w-px bg-red-400 z-10 pointer-events-none"
                              style={{ left: todayPosition }}
                            />
                          )}

                          {/* Project bar */}
                          {bar && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div
                                  className="absolute top-1/2 -translate-y-1/2 h-7 rounded-md transition-all group-hover:h-8"
                                  style={{
                                    left: bar.left,
                                    width: bar.width,
                                    backgroundColor: phaseColor,
                                    opacity: project.status === "on_hold" ? 0.5 : 0.85,
                                  }}
                                >
                                  {/* Completion fill */}
                                  <div
                                    className="absolute inset-y-0 left-0 rounded-l-md bg-white/20"
                                    style={{ width: `${project.completionPercentage}%` }}
                                  />
                                  {/* Label inside bar */}
                                  <div className="absolute inset-0 flex items-center px-2 overflow-hidden">
                                    <span className="text-[10px] font-medium text-white truncate">
                                      {project.completionPercentage}%
                                    </span>
                                  </div>
                                </div>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-xs">
                                <div className="space-y-1">
                                  <p className="font-semibold">{project.name}</p>
                                  <p className="text-xs">{project.clientName}</p>
                                  <div className="flex gap-3 text-xs">
                                    <span>Start: {project.startDate ? new Date(project.startDate).toLocaleDateString() : "N/A"}</span>
                                    <span>End: {project.deadline ? new Date(project.deadline).toLocaleDateString() : "N/A"}</span>
                                  </div>
                                  <div className="flex gap-3 text-xs">
                                    <span>Phase: {getPhaseLabel(project.phase)}</span>
                                    <span>{project.completionPercentage}% complete</span>
                                  </div>
                                  <p className="text-xs">{taskCount} active task(s)</p>
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          )}

                          {projectOverlaps.map((overlap) => {
                            const position = getOverlapPosition(overlap.overlapStart, overlap.overlapEnd);
                            if (!position) return null;
                            return (
                              <Tooltip key={`${overlap.memberId}-${overlap.projectA.id}-${overlap.projectB.id}`}>
                                <TooltipTrigger asChild>
                                  <div aria-label={`Potential schedule overlap for ${overlap.memberName}: ${overlap.projectA.name} and ${overlap.projectB.name}, ${formatOverlapRange(overlap)}`} className="absolute top-1/2 z-20 h-7 -translate-y-1/2 border-x-2 border-amber-600 bg-amber-300/75 transition-all group-hover:h-8" style={position} />
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p className="text-xs font-medium">Potential schedule overlap · {overlap.memberName}</p>
                                  <p className="text-xs">{overlap.projectA.name} + {overlap.projectB.name}</p>
                                  <p className="text-xs text-muted-foreground">{formatOverlapRange(overlap)}</p>
                                </TooltipContent>
                              </Tooltip>
                            );
                          })}

                          {/* Task markers */}
                          {ganttData?.tasks
                            .filter(t => t.projectId === project.id && t.deadline)
                            .map(task => {
                              const taskDay = (new Date(task.deadline!).getTime() - startDate.getTime()) / 86400000;
                              if (taskDay < 0 || taskDay > totalDays) return null;
                              const taskLeft = `${(taskDay / totalDays) * 100}%`;
                              const isOverdue = task.status !== "done" && new Date(task.deadline!) < new Date() && project.status !== "on_hold";
                              return (
                                <Tooltip key={task.id}>
                                  <TooltipTrigger asChild>
                                    <div
                                      className={`absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full z-10 ${isOverdue ? "bg-red-500" : "bg-white border-2 border-slate-400"}`}
                                      style={{ left: taskLeft }}
                                    />
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p className="text-xs font-medium">{task.title}</p>
                                    <p className="text-xs text-muted-foreground">
                                      Due: {new Date(task.deadline!).toLocaleDateString()}
                                      {isOverdue && " (Overdue)"}
                                    </p>
                                  </TooltipContent>
                                </Tooltip>
                              );
                            })}
                        </div>
                      </div>

                      {/* Staff member sub-bars */}
                      {memberBars.map(({ member, firstAssigned, lastDeadline }) => {
                        const memberEnd = lastDeadline || (project.deadline ? new Date(project.deadline) : null);
                        const memberBar = getBarPosition(firstAssigned, memberEnd);
                        if (!memberBar) return null;
                        return (
                          <div
                            key={`${project.id}-${member.id}`}
                            className="flex border-b border-border/20 bg-muted/10"
                          >
                            {/* Member name */}
                            <div className="w-[260px] shrink-0 px-3 py-1.5 border-r border-border pl-8">
                              <div className="flex items-center gap-2">
                                <div
                                  className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-semibold shrink-0"
                                  style={{ backgroundColor: member.avatarColor || "#6366f1" }}
                                >
                                  {member.name.charAt(0)}
                                </div>
                                <span className="text-[11px] text-muted-foreground truncate">{member.name}</span>
                              </div>
                            </div>

                            {/* Member bar */}
                            <div className="flex-1 relative py-1.5">
                              {/* Grid lines */}
                              <div className="absolute inset-0 flex pointer-events-none">
                                {months.map((_, i) => (
                                  <div key={i} className="flex-1 border-r border-border/20 last:border-r-0" />
                                ))}
                              </div>
                              {/* Today line */}
                              {todayPosition && (
                                <div
                                  className="absolute top-0 bottom-0 w-px bg-red-400/40 z-10 pointer-events-none"
                                  style={{ left: todayPosition }}
                                />
                              )}
                              {/* Bar */}
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div
                                    className="absolute top-1/2 -translate-y-1/2 h-4 rounded-sm"
                                    style={{
                                      left: memberBar.left,
                                      width: memberBar.width,
                                      backgroundColor: member.avatarColor || "#6366f1",
                                      opacity: 0.6,
                                    }}
                                  />
                                </TooltipTrigger>
                                <TooltipContent side="top">
                                  <p className="text-xs font-medium">{member.name}</p>
                                  <p className="text-xs text-muted-foreground">
                                    First task start: {firstAssigned.toLocaleDateString()}
                                    {memberEnd && ` — Last deadline: ${memberEnd.toLocaleDateString()}`}
                                  </p>
                                </TooltipContent>
                              </Tooltip>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })
              ))}
            </div>
          </div>

          {/* Legend */}
          <div className="flex items-center gap-6 mt-4 pt-4 border-t border-border">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <div className="w-3 h-0.5 bg-red-400" />
              Today
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <div className="w-4 h-3 rounded-sm bg-indigo-600 opacity-85" />
              Project Duration
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <div className="w-2 h-2 rounded-full bg-white border-2 border-slate-400" />
              Task Deadline
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <div className="w-2 h-2 rounded-full bg-red-500" />
              Overdue Task
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <div className="h-3 w-4 border-x-2 border-amber-600 bg-amber-300/75" />
              Potential schedule overlap
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <div className="w-4 h-2.5 rounded-sm bg-indigo-400 opacity-60" />
              Staff Member
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Resource Allocation Summary */}
      {ganttData?.members && ganttData.members.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Resource Allocation
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {ganttData.members.map(member => {
                const memberTasks = ganttData.tasks.filter(t => t.assigneeId === member.id);
                const memberProjectIds = Array.from(new Set(memberTasks.map(t => t.projectId)));
                const memberProjects = ganttData.projects.filter(p => memberProjectIds.includes(p.id));
                const now = new Date();
                const overdueTasks = memberTasks.filter(t => t.status !== "done" && t.deadline != null && new Date(t.deadline) < now);

                return (
                  <div key={member.id} className="flex items-start gap-3 p-3 rounded-lg border border-border/50 hover:bg-muted/30 transition-colors">
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-semibold shrink-0"
                      style={{ backgroundColor: member.avatarColor || "#6366f1" }}
                    >
                      {member.name.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{member.name}</p>
                      <p className="text-xs text-muted-foreground">{member.title}</p>
                      <div className="flex items-center gap-3 mt-1.5">
                        <span className="text-xs">
                          <span className="font-medium">{memberProjects.length}</span> project(s)
                        </span>
                        <span className="text-xs">
                          <span className="font-medium">{memberTasks.length}</span> task(s)
                        </span>
                        {overdueTasks.length > 0 && (
                          <span className="text-xs text-red-600 font-medium">
                            {overdueTasks.length} overdue
                          </span>
                        )}
                      </div>
                      {/* Mini project bars */}
                      <div className="mt-2 space-y-1">
                        {memberProjects.slice(0, 3).map(proj => (
                          <div key={proj.id} className="flex items-center gap-2">
                            <div
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{ backgroundColor: PHASE_COLORS[proj.phase] || "#6366f1" }}
                            />
                            <span className="text-[10px] text-muted-foreground truncate">{proj.name}</span>
                          </div>
                        ))}
                        {memberProjects.length > 3 && (
                          <span className="text-[10px] text-muted-foreground">+{memberProjects.length - 3} more</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
