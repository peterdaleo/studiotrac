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

  // Detect resource conflicts (same team member on overlapping projects)
  const conflicts = useMemo(() => {
    if (!ganttData) return new Set<number>();
    const memberProjects: Record<number, Array<{ projectId: number; start: number; end: number }>> = {};
    
    // Group tasks by assignee and project
    for (const task of ganttData.tasks) {
      if (!task.assigneeId) continue;
      if (!memberProjects[task.assigneeId]) memberProjects[task.assigneeId] = [];
      const project = ganttData.projects.find(p => p.id === task.projectId);
      if (!project?.startDate || !project?.deadline) continue;
      const existing = memberProjects[task.assigneeId].find(mp => mp.projectId === project.id);
      if (!existing) {
        memberProjects[task.assigneeId].push({
          projectId: project.id,
          start: new Date(project.startDate).getTime(),
          end: new Date(project.deadline).getTime(),
        });
      }
    }

    const conflictProjectIds = new Set<number>();
    for (const assignments of Object.values(memberProjects)) {
      if (assignments.length < 2) continue;
      for (let i = 0; i < assignments.length; i++) {
        for (let j = i + 1; j < assignments.length; j++) {
          const a = assignments[i]!;
          const b = assignments[j]!;
          if (a.start <= b.end && b.start <= a.end) {
            conflictProjectIds.add(a.projectId);
            conflictProjectIds.add(b.projectId);
          }
        }
      }
    }
    return conflictProjectIds;
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
      {Array.from(conflicts).length > 0 && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="py-3 px-4 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
            <div>
              <p className="text-sm font-medium text-amber-800">
                Resource Conflict Detected
              </p>
              <p className="text-xs text-amber-600">
                {Array.from(conflicts).length} project(s) have overlapping schedules with shared team members. Review assignments to avoid overallocation.
              </p>
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
                  Project
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

              {/* Project Rows */}
              {filteredProjects.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground">
                  No projects to display in this view
                </div>
              ) : (
                filteredProjects.map((project) => {
                  const bar = getBarPosition(project.startDate, project.deadline);
                  const hasConflict = conflicts.has(project.id);
                  const taskCount = ganttData?.tasks.filter(t => t.projectId === project.id).length ?? 0;
                  const phaseColor = PHASE_COLORS[project.phase] || "#6366f1";

                  return (
                    <div
                      key={project.id}
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
                                  <TooltipContent>Resource conflict detected</TooltipContent>
                                </Tooltip>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${STATUS_BADGE_COLORS[project.status] || ""}`}>
                                {project.status.replace("_", " ")}
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
                                className={`absolute top-1/2 -translate-y-1/2 h-7 rounded-md transition-all group-hover:h-8 ${hasConflict ? "ring-2 ring-amber-400 ring-offset-1" : ""}`}
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

                        {/* Task markers */}
                        {ganttData?.tasks
                          .filter(t => t.projectId === project.id && t.deadline)
                          .map(task => {
                            const taskDay = (new Date(task.deadline!).getTime() - startDate.getTime()) / 86400000;
                            if (taskDay < 0 || taskDay > totalDays) return null;
                            const taskLeft = `${(taskDay / totalDays) * 100}%`;
                            const isOverdue = task.status === "overdue";
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
                  );
                })
              )}
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
              <AlertTriangle className="h-3 w-3 text-amber-500" />
              Resource Conflict
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
                const overdueTasks = memberTasks.filter(t => t.status === "overdue");

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
