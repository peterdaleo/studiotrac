import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Plus,
  Users,
  CheckCircle2,
  AlertTriangle,
  Clock,
  FolderKanban,
  ArrowLeft,
} from "lucide-react";
import { useLocation, useParams } from "wouter";
import { getPhaseShortLabel, getStatusLabel } from "@shared/constants";
import { toast } from "sonner";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

const statusDotMap: Record<string, string> = {
  on_track: "bg-emerald-500",
  on_hold: "bg-amber-500",
  delayed: "bg-red-500",
  completed: "bg-slate-400",
};

export default function Team() {
  const params = useParams<{ id?: string }>();
  const selectedMemberId = params.id ? Number(params.id) : null;
  const [, setLocation] = useLocation();
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: teamMembers, isLoading } = trpc.teamMembers.list.useQuery();
  const { data: allTasks } = trpc.tasks.list.useQuery({});
  const { data: projects } = trpc.projects.list.useQuery({});
  const utils = trpc.useUtils();

  const createMember = trpc.teamMembers.create.useMutation({
    onSuccess: () => {
      utils.teamMembers.list.invalidate();
      setDialogOpen(false);
      toast.success("Team member added");
    },
  });

  const memberStats = useMemo(() => {
    if (!teamMembers || !allTasks) return [];
    return teamMembers.map((m) => {
      const memberTasks = allTasks.filter((t) => t.assigneeId === m.id);
      const completed = memberTasks.filter((t) => t.status === "done").length;
      const overdue = memberTasks.filter((t) => t.status === "overdue").length;
      const inProgress = memberTasks.filter((t) => t.status === "in_progress").length;
      const total = memberTasks.length;
      const missedRate = total > 0 ? Math.round((overdue / total) * 100) : 0;
      const activeProjectIds = new Set(memberTasks.filter((t) => t.status !== "done").map((t) => t.projectId));
      return {
        ...m,
        totalTasks: total,
        completed,
        overdue,
        inProgress,
        missedRate,
        activeProjects: activeProjectIds.size,
      };
    });
  }, [teamMembers, allTasks]);

  const selectedMember = selectedMemberId ? memberStats.find((m) => m.id === selectedMemberId) : null;
  const selectedMemberTasks = useMemo(() => {
    if (!selectedMemberId || !allTasks) return [];
    return allTasks.filter((t) => t.assigneeId === selectedMemberId);
  }, [selectedMemberId, allTasks]);

  const selectedMemberProjects = useMemo(() => {
    if (!selectedMemberId || !allTasks || !projects) return [];
    const projectIds = new Set(allTasks.filter((t) => t.assigneeId === selectedMemberId).map((t) => t.projectId));
    return projects.filter((p) => projectIds.has(p.id));
  }, [selectedMemberId, allTasks, projects]);

  const workloadChartData = useMemo(() => {
    return memberStats.map((m) => ({
      name: m.name.split(" ")[0],
      tasks: m.totalTasks,
      completed: m.completed,
      overdue: m.overdue,
    }));
  }, [memberStats]);

  const handleCreate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    createMember.mutate({
      name: fd.get("name") as string,
      email: (fd.get("email") as string) || undefined,
      title: (fd.get("title") as string) || undefined,
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-32" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
        </div>
      </div>
    );
  }

  // Member Detail View
  if (selectedMember) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/team")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Avatar className="h-12 w-12 border-2" style={{ borderColor: selectedMember.avatarColor ?? "#6366f1" }}>
            <AvatarFallback className="text-lg font-semibold" style={{ backgroundColor: (selectedMember.avatarColor ?? "#6366f1") + "20", color: selectedMember.avatarColor ?? "#6366f1" }}>
              {selectedMember.name.charAt(0)}
            </AvatarFallback>
          </Avatar>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{selectedMember.name}</h1>
            <p className="text-sm text-muted-foreground">{selectedMember.title ?? "Team Member"}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold">{selectedMember.totalTasks}</p>
              <p className="text-xs text-muted-foreground mt-1">Total Tasks</p>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-emerald-600">{selectedMember.completed}</p>
              <p className="text-xs text-muted-foreground mt-1">Completed</p>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 text-center">
              <p className="text-2xl font-bold text-red-600">{selectedMember.overdue}</p>
              <p className="text-xs text-muted-foreground mt-1">Overdue</p>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 text-center">
              <p className={`text-2xl font-bold ${selectedMember.missedRate > 20 ? "text-red-600" : selectedMember.missedRate > 10 ? "text-amber-600" : "text-emerald-600"}`}>
                {selectedMember.missedRate}%
              </p>
              <p className="text-xs text-muted-foreground mt-1">Missed Rate</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Assigned Projects */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Assigned Projects ({selectedMemberProjects.length})</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {selectedMemberProjects.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No projects assigned</p>
              ) : (
                <div className="divide-y">
                  {selectedMemberProjects.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setLocation(`/projects/${p.id}`)}
                      className="w-full flex items-center gap-3 px-5 py-3 hover:bg-muted/30 transition-colors text-left"
                    >
                      <div className={`h-2 w-2 rounded-full shrink-0 ${statusDotMap[p.status] ?? "bg-slate-400"}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{p.name}</p>
                        <p className="text-xs text-muted-foreground">{getPhaseShortLabel(p.phase)} - {p.completionPercentage}%</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Tasks */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Tasks ({selectedMemberTasks.length})</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {selectedMemberTasks.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No tasks assigned</p>
              ) : (
                <div className="divide-y">
                  {selectedMemberTasks.map((t) => {
                    const isOverdue = t.deadline && new Date(t.deadline) < new Date() && t.status !== "done";
                    return (
                      <div key={t.id} className="flex items-center gap-3 px-5 py-3">
                        {t.status === "done" ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                        ) : isOverdue ? (
                          <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />
                        ) : (
                          <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm truncate ${t.status === "done" ? "line-through text-muted-foreground" : ""}`}>{t.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {projects?.find((p) => p.id === t.projectId)?.name ?? ""}
                          </p>
                        </div>
                        <Badge variant="outline" className="text-[10px]">P{t.priority}</Badge>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Team Overview
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Team</h1>
          <p className="text-muted-foreground mt-1">
            {teamMembers?.length ?? 0} team members
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" /> Add Member
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Team Member</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input name="name" placeholder="Full name" required />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input name="email" type="email" placeholder="email@studio.com" />
              </div>
              <div className="space-y-2">
                <Label>Title</Label>
                <Input name="title" placeholder="e.g., Senior Architect" />
              </div>
              <div className="flex justify-end gap-3">
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={createMember.isPending}>
                  {createMember.isPending ? "Adding..." : "Add Member"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Workload Chart */}
      {workloadChartData.length > 0 && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Team Workload Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={workloadChartData} margin={{ left: 0, right: 16 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                  />
                  <Bar dataKey="completed" fill="#10b981" radius={[4, 4, 0, 0]} name="Completed" stackId="a" />
                  <Bar dataKey="overdue" fill="#ef4444" radius={[4, 4, 0, 0]} name="Overdue" stackId="a" />
                  <Bar dataKey="tasks" fill="oklch(0.55 0.15 230)" radius={[4, 4, 0, 0]} name="Total" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Team Grid */}
      {memberStats.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20">
          <Users className="h-12 w-12 text-muted-foreground/30 mb-4" />
          <h3 className="text-lg font-medium">No team members yet</h3>
          <p className="text-sm text-muted-foreground mt-1">Add your first team member to get started</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {memberStats.map((member) => (
            <Card
              key={member.id}
              className="border-0 shadow-sm hover:shadow-md transition-all cursor-pointer group"
              onClick={() => setLocation(`/team/${member.id}`)}
            >
              <CardContent className="p-5">
                <div className="flex items-center gap-3 mb-4">
                  <Avatar className="h-10 w-10 border-2" style={{ borderColor: member.avatarColor ?? "#6366f1" }}>
                    <AvatarFallback className="font-semibold" style={{ backgroundColor: (member.avatarColor ?? "#6366f1") + "20", color: member.avatarColor ?? "#6366f1" }}>
                      {member.name.charAt(0)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm group-hover:text-primary transition-colors truncate">{member.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{member.title ?? "Team Member"}</p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 text-center">
                  <div>
                    <p className="text-lg font-bold">{member.totalTasks}</p>
                    <p className="text-[10px] text-muted-foreground">Tasks</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-emerald-600">{member.activeProjects}</p>
                    <p className="text-[10px] text-muted-foreground">Projects</p>
                  </div>
                  <div>
                    <p className={`text-lg font-bold ${member.missedRate > 20 ? "text-red-600" : member.missedRate > 10 ? "text-amber-600" : "text-emerald-600"}`}>
                      {member.missedRate}%
                    </p>
                    <p className="text-[10px] text-muted-foreground">Missed</p>
                  </div>
                </div>

                {member.totalTasks > 0 && (
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
                      <span>Completion</span>
                      <span>{member.totalTasks > 0 ? Math.round((member.completed / member.totalTasks) * 100) : 0}%</span>
                    </div>
                    <Progress value={member.totalTasks > 0 ? (member.completed / member.totalTasks) * 100 : 0} className="h-1.5" />
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
