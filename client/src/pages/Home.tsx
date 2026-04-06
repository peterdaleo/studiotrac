import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FolderKanban,
  CheckCircle2,
  AlertTriangle,
  Clock,
  TrendingUp,
  ArrowRight,
  Zap,
  PauseCircle,
} from "lucide-react";
import { useLocation } from "wouter";
import { getPhaseShortLabel, getStatusLabel, getStatusColor } from "@shared/constants";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";

const statusColorMap: Record<string, string> = {
  on_track: "bg-emerald-500",
  on_hold: "bg-amber-500",
  delayed: "bg-red-500",
  completed: "bg-slate-400",
};

const statusBadgeMap: Record<string, string> = {
  on_track: "bg-emerald-500/10 text-emerald-700 border-emerald-200",
  on_hold: "bg-amber-500/10 text-amber-700 border-amber-200",
  delayed: "bg-red-500/10 text-red-700 border-red-200",
  completed: "bg-slate-500/10 text-slate-600 border-slate-200",
};

export default function Home() {
  const [, setLocation] = useLocation();
  const { data: stats, isLoading: statsLoading } = trpc.dashboard.stats.useQuery();
  const { data: projects, isLoading: projectsLoading } = trpc.projects.list.useQuery({});
  const { data: allTasks } = trpc.tasks.list.useQuery({});
  const seedMutation = trpc.dashboard.seed.useMutation({
    onSuccess: () => window.location.reload(),
  });

  const recentProjects = projects?.slice(0, 5) ?? [];
  const upcomingDeadlines = allTasks
    ?.filter((t) => t.deadline && t.status !== "done" && new Date(t.deadline) > new Date())
    .sort((a, b) => new Date(a.deadline!).getTime() - new Date(b.deadline!).getTime())
    .slice(0, 5) ?? [];

  const overdueTasks = allTasks?.filter((t) => t.status === "overdue") ?? [];

  if (statsLoading || projectsLoading) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton className="h-8 w-48 mb-2" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-80 rounded-xl" />
          <Skeleton className="h-80 rounded-xl" />
        </div>
      </div>
    );
  }

  if (!stats || stats.totalProjects === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6">
        <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center">
          <FolderKanban className="h-8 w-8 text-primary" />
        </div>
        <div className="text-center space-y-2">
          <h2 className="text-2xl font-semibold">Welcome to studioTrac</h2>
          <p className="text-muted-foreground max-w-md">
            Your architectural project management workspace is ready. Seed demo data to explore, or start adding your own projects.
          </p>
        </div>
        <div className="flex gap-3">
          <Button onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending}>
            {seedMutation.isPending ? "Seeding..." : "Load Demo Data"}
          </Button>
          <Button variant="outline" onClick={() => setLocation("/projects")}>
            Create Project
          </Button>
        </div>
      </div>
    );
  }

  const pieData = [
    { name: "On Track", value: stats.onTrack, fill: "#10b981" },
    { name: "Delayed", value: stats.delayed, fill: "#ef4444" },
    { name: "On Hold", value: stats.onHold, fill: "#f59e0b" },
    { name: "Completed", value: stats.completed, fill: "#94a3b8" },
  ].filter((d) => d.value > 0);

  const phaseData = projects?.reduce((acc, p) => {
    const label = getPhaseShortLabel(p.phase);
    const existing = acc.find((a) => a.phase === label);
    if (existing) existing.count++;
    else acc.push({ phase: label, count: 1 });
    return acc;
  }, [] as { phase: string; count: number }[]) ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-1">
          Overview of your studio's projects and performance
        </p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-0 shadow-sm bg-card hover:shadow-md transition-shadow">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Active Projects</p>
                <p className="text-3xl font-bold mt-1">{stats.totalProjects - stats.completed}</p>
              </div>
              <div className="h-11 w-11 rounded-xl bg-primary/10 flex items-center justify-center">
                <FolderKanban className="h-5 w-5 text-primary" />
              </div>
            </div>
            <div className="flex items-center gap-1.5 mt-3 text-xs text-muted-foreground">
              <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
              <span>{stats.completed} completed this period</span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm bg-card hover:shadow-md transition-shadow">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">On Track</p>
                <p className="text-3xl font-bold mt-1 text-emerald-600">{stats.onTrack}</p>
              </div>
              <div className="h-11 w-11 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
              </div>
            </div>
            <Progress value={stats.totalProjects > 0 ? (stats.onTrack / stats.totalProjects) * 100 : 0} className="mt-3 h-1.5" />
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm bg-card hover:shadow-md transition-shadow">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Delayed</p>
                <p className="text-3xl font-bold mt-1 text-red-600">{stats.delayed}</p>
              </div>
              <div className="h-11 w-11 rounded-xl bg-red-500/10 flex items-center justify-center">
                <AlertTriangle className="h-5 w-5 text-red-500" />
              </div>
            </div>
            <div className="flex items-center gap-1.5 mt-3 text-xs text-muted-foreground">
              <Zap className="h-3.5 w-3.5 text-red-500" />
              <span>{stats.overdueTasks} overdue tasks</span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm bg-card hover:shadow-md transition-shadow">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Task Completion</p>
                <p className="text-3xl font-bold mt-1">
                  {stats.totalTasks > 0 ? Math.round((stats.completedTasks / stats.totalTasks) * 100) : 0}%
                </p>
              </div>
              <div className="h-11 w-11 rounded-xl bg-primary/10 flex items-center justify-center">
                <Clock className="h-5 w-5 text-primary" />
              </div>
            </div>
            <Progress value={stats.totalTasks > 0 ? (stats.completedTasks / stats.totalTasks) * 100 : 0} className="mt-3 h-1.5" />
          </CardContent>
        </Card>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Project Status Distribution */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Project Health</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-8">
              <div className="w-40 h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={45}
                      outerRadius={70}
                      paddingAngle={3}
                      dataKey="value"
                      strokeWidth={0}
                    >
                      {pieData.map((entry, index) => (
                        <Cell key={index} fill={entry.fill} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1 space-y-3">
                {pieData.map((item) => (
                  <div key={item.name} className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="h-3 w-3 rounded-full" style={{ backgroundColor: item.fill }} />
                      <span className="text-sm">{item.name}</span>
                    </div>
                    <span className="text-sm font-semibold">{item.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Phase Distribution */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Projects by Phase</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[180px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={phaseData} layout="vertical" margin={{ left: 0, right: 16, top: 0, bottom: 0 }}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="phase" width={36} tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                  />
                  <Bar dataKey="count" fill="oklch(0.55 0.15 230)" radius={[0, 6, 6, 0]} barSize={20} name="Projects" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Projects + Deadlines Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Projects */}
        <Card className="border-0 shadow-sm lg:col-span-2">
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-base font-semibold">Recent Projects</CardTitle>
            <Button variant="ghost" size="sm" className="text-xs" onClick={() => setLocation("/projects")}>
              View all <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {recentProjects.map((project) => (
                <button
                  key={project.id}
                  onClick={() => setLocation(`/projects/${project.id}`)}
                  className="w-full flex items-center gap-4 px-6 py-3.5 hover:bg-muted/50 transition-colors text-left"
                >
                  <div className={`h-2 w-2 rounded-full shrink-0 ${statusColorMap[project.status] ?? "bg-slate-400"}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{project.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{project.clientName}</p>
                  </div>
                  <Badge variant="outline" className={`text-[10px] shrink-0 ${statusBadgeMap[project.status] ?? ""}`}>
                    {getStatusLabel(project.status)}
                  </Badge>
                  <div className="text-right shrink-0">
                    <p className="text-xs font-medium">{getPhaseShortLabel(project.phase)}</p>
                    <p className="text-xs text-muted-foreground">{project.completionPercentage}%</p>
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Upcoming Deadlines + Overdue */}
        <div className="space-y-6">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                Upcoming Deadlines
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {upcomingDeadlines.length === 0 ? (
                <p className="text-sm text-muted-foreground">No upcoming deadlines</p>
              ) : (
                upcomingDeadlines.map((task) => {
                  const daysLeft = Math.ceil(
                    (new Date(task.deadline!).getTime() - Date.now()) / 86400000
                  );
                  return (
                    <div key={task.id} className="flex items-start gap-3">
                      <div className={`h-1.5 w-1.5 rounded-full mt-1.5 shrink-0 ${daysLeft <= 3 ? "bg-red-500" : daysLeft <= 7 ? "bg-amber-500" : "bg-emerald-500"}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate">{task.title}</p>
                        <p className={`text-xs ${daysLeft <= 3 ? "text-red-600 font-medium" : "text-muted-foreground"}`}>
                          {daysLeft === 0 ? "Due today" : daysLeft === 1 ? "Due tomorrow" : `${daysLeft} days left`}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>

          {overdueTasks.length > 0 && (
            <Card className="border-0 shadow-sm border-l-4 border-l-red-500">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold flex items-center gap-2 text-red-600">
                  <AlertTriangle className="h-4 w-4" />
                  Overdue Tasks ({overdueTasks.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {overdueTasks.slice(0, 3).map((task) => (
                  <div key={task.id} className="text-sm">
                    <p className="truncate">{task.title}</p>
                    <p className="text-xs text-red-500">
                      {Math.abs(Math.ceil((new Date(task.deadline!).getTime() - Date.now()) / 86400000))} days overdue
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
