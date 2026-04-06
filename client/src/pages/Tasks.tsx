import { useState, useMemo, useCallback, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Plus,
  Search,
  CheckCircle2,
  Circle,
  Clock,
  GripVertical,
  Trash2,
  AlertTriangle,
  CheckSquare,
  Filter,
} from "lucide-react";
import { useLocation } from "wouter";
import { TASK_STATUSES } from "@shared/constants";
import { toast } from "sonner";

const taskStatusColors: Record<string, string> = {
  todo: "bg-slate-100 text-slate-700 border-slate-200",
  in_progress: "bg-blue-100 text-blue-700 border-blue-200",
  done: "bg-emerald-100 text-emerald-700 border-emerald-200",
  overdue: "bg-red-100 text-red-700 border-red-200",
};

const priorityColor = (p: number) => {
  if (p <= 3) return "bg-red-500 text-white";
  if (p <= 7) return "bg-amber-500 text-white";
  if (p <= 12) return "bg-blue-500 text-white";
  return "bg-slate-400 text-white";
};

export default function Tasks() {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draggedId, setDraggedId] = useState<number | null>(null);

  const { data: allTasks, isLoading } = trpc.tasks.list.useQuery({});
  const { data: projects } = trpc.projects.list.useQuery({});
  const { data: teamMembers } = trpc.teamMembers.list.useQuery();
  const utils = trpc.useUtils();

  const createTask = trpc.tasks.create.useMutation({
    onSuccess: () => {
      utils.tasks.list.invalidate();
      setDialogOpen(false);
      toast.success("Task created");
    },
  });

  const updateTask = trpc.tasks.update.useMutation({
    onSuccess: () => utils.tasks.list.invalidate(),
  });

  const deleteTask = trpc.tasks.delete.useMutation({
    onSuccess: () => {
      utils.tasks.list.invalidate();
      toast.success("Task deleted");
    },
  });

  const reorderTasks = trpc.tasks.reorder.useMutation({
    onSuccess: () => utils.tasks.list.invalidate(),
  });

  const filtered = useMemo(() => {
    if (!allTasks) return [];
    return allTasks.filter((t) => {
      if (statusFilter !== "all" && t.status !== statusFilter) return false;
      if (projectFilter !== "all" && t.projectId !== Number(projectFilter)) return false;
      if (assigneeFilter !== "all" && t.assigneeId !== Number(assigneeFilter)) return false;
      if (search) {
        return t.title.toLowerCase().includes(search.toLowerCase());
      }
      return true;
    });
  }, [allTasks, statusFilter, projectFilter, assigneeFilter, search]);

  const getProjectName = (id: number) => projects?.find((p) => p.id === id)?.name ?? "Unknown";
  const getMemberName = (id: number | null) => teamMembers?.find((m) => m.id === id)?.name ?? "Unassigned";

  const handleDragStart = (e: React.DragEvent, taskId: number) => {
    setDraggedId(taskId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", taskId.toString());
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (e: React.DragEvent, targetId: number) => {
    e.preventDefault();
    if (draggedId === null || draggedId === targetId) return;

    const taskList = [...filtered];
    const dragIdx = taskList.findIndex((t) => t.id === draggedId);
    const dropIdx = taskList.findIndex((t) => t.id === targetId);
    if (dragIdx === -1 || dropIdx === -1) return;

    const [moved] = taskList.splice(dragIdx, 1);
    taskList.splice(dropIdx, 0, moved);

    const orders = taskList.map((t, i) => ({ id: t.id, sortOrder: i }));
    reorderTasks.mutate({ taskOrders: orders });
    setDraggedId(null);
  };

  const handleCreate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    createTask.mutate({
      projectId: Number(fd.get("projectId")),
      title: fd.get("title") as string,
      assigneeId: fd.get("assigneeId") ? Number(fd.get("assigneeId")) : undefined,
      priority: fd.get("priority") ? Number(fd.get("priority")) : 10,
      deadline: fd.get("deadline") ? new Date(fd.get("deadline") as string) : undefined,
      description: (fd.get("description") as string) || undefined,
    });
  };

  const taskStats = useMemo(() => {
    if (!allTasks) return { total: 0, todo: 0, inProgress: 0, done: 0, overdue: 0 };
    return {
      total: allTasks.length,
      todo: allTasks.filter((t) => t.status === "todo").length,
      inProgress: allTasks.filter((t) => t.status === "in_progress").length,
      done: allTasks.filter((t) => t.status === "done").length,
      overdue: allTasks.filter((t) => t.status === "overdue").length,
    };
  }, [allTasks]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-32" />
        <div className="grid grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tasks</h1>
          <p className="text-muted-foreground mt-1">
            Manage and prioritize tasks across all projects
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" /> New Task
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Task</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-2">
                <Label>Task Title</Label>
                <Input name="title" placeholder="e.g., Review structural drawings" required />
              </div>
              <div className="space-y-2">
                <Label>Project</Label>
                <select name="projectId" required className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm">
                  <option value="">Select project</option>
                  {projects?.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Assignee</Label>
                  <select name="assigneeId" className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm">
                    <option value="">Unassigned</option>
                    {teamMembers?.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>Priority (1-20)</Label>
                  <Input name="priority" type="number" min={1} max={20} defaultValue={10} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Deadline</Label>
                <Input name="deadline" type="date" />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea name="description" placeholder="Task details..." rows={2} />
              </div>
              <div className="flex justify-end gap-3">
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={createTask.isPending}>
                  {createTask.isPending ? "Creating..." : "Create Task"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-slate-100 flex items-center justify-center">
              <CheckSquare className="h-4 w-4 text-slate-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">To Do</p>
              <p className="text-lg font-bold">{taskStats.todo}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-blue-100 flex items-center justify-center">
              <Clock className="h-4 w-4 text-blue-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">In Progress</p>
              <p className="text-lg font-bold">{taskStats.inProgress}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-emerald-100 flex items-center justify-center">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Done</p>
              <p className="text-lg font-bold">{taskStats.done}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-red-100 flex items-center justify-center">
              <AlertTriangle className="h-4 w-4 text-red-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Overdue</p>
              <p className="text-lg font-bold text-red-600">{taskStats.overdue}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search tasks..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {TASK_STATUSES.map((s) => (
              <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={projectFilter} onValueChange={setProjectFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All Projects" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Projects</SelectItem>
            {projects?.map((p) => (
              <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="All Members" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Members</SelectItem>
            {teamMembers?.map((m) => (
              <SelectItem key={m.id} value={m.id.toString()}>{m.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Task List */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="py-16 text-center">
              <CheckSquare className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
              <h3 className="font-medium">No tasks found</h3>
              <p className="text-sm text-muted-foreground mt-1">
                {search || statusFilter !== "all" ? "Try adjusting your filters" : "Create your first task"}
              </p>
            </div>
          ) : (
            <div className="divide-y">
              {filtered.map((task) => {
                const isOverdue = task.deadline && new Date(task.deadline) < new Date() && task.status !== "done";
                return (
                  <div
                    key={task.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, task.id)}
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e, task.id)}
                    className={`flex items-center gap-3 px-5 py-3.5 hover:bg-muted/30 transition-all ${
                      draggedId === task.id ? "opacity-50" : ""
                    }`}
                  >
                    <GripVertical className="h-4 w-4 text-muted-foreground/30 cursor-grab shrink-0" />
                    <button
                      onClick={() => {
                        const newStatus = task.status === "done" ? "todo" : "done";
                        updateTask.mutate({
                          id: task.id,
                          status: newStatus,
                          completedAt: newStatus === "done" ? new Date() : null,
                        });
                      }}
                      className="shrink-0"
                    >
                      {task.status === "done" ? (
                        <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                      ) : (
                        <Circle className={`h-5 w-5 ${isOverdue ? "text-red-400" : "text-muted-foreground/30"}`} />
                      )}
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${task.status === "done" ? "line-through text-muted-foreground" : ""}`}>
                        {task.title}
                      </p>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        <button
                          onClick={() => setLocation(`/projects/${task.projectId}`)}
                          className="hover:text-primary transition-colors truncate max-w-[200px]"
                        >
                          {getProjectName(task.projectId)}
                        </button>
                        <span>{getMemberName(task.assigneeId)}</span>
                        {task.deadline && (
                          <span className={`flex items-center gap-1 ${isOverdue ? "text-red-500 font-medium" : ""}`}>
                            <Clock className="h-3 w-3" />
                            {new Date(task.deadline).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className={`h-6 w-8 rounded text-[10px] font-bold flex items-center justify-center shrink-0 ${priorityColor(task.priority)}`}>
                      {task.priority}
                    </div>
                    <Select
                      value={task.status}
                      onValueChange={(v) => updateTask.mutate({
                        id: task.id,
                        status: v as any,
                        completedAt: v === "done" ? new Date() : null,
                      })}
                    >
                      <SelectTrigger className={`w-[110px] h-7 text-[10px] border ${taskStatusColors[task.status] ?? ""}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TASK_STATUSES.map((s) => (
                          <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 opacity-0 group-hover:opacity-100 hover:opacity-100 shrink-0"
                      onClick={() => deleteTask.mutate({ id: task.id })}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground text-center">
        Drag tasks to reorder priority. Lower priority numbers indicate higher urgency.
      </p>
    </div>
  );
}
