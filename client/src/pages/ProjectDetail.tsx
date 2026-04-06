import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
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
  ArrowLeft,
  MapPin,
  Calendar,
  User,
  DollarSign,
  CheckCircle2,
  Circle,
  Plus,
  Trash2,
  Edit3,
  MessageSquare,
  Eye,
  EyeOff,
  Clock,
  AlertTriangle,
  Paperclip,
  Upload,
  FileText,
  Image as ImageIcon,
  File,
  Download,
  X,
} from "lucide-react";
import { useLocation, useParams } from "wouter";
import {
  PROJECT_PHASES,
  PROJECT_STATUSES,
  getPhaseLabel,
  getPhaseShortLabel,
  getStatusLabel,
} from "@shared/constants";
import { toast } from "sonner";

const statusColorMap: Record<string, string> = {
  on_track: "bg-emerald-500/10 text-emerald-700 border-emerald-200",
  on_hold: "bg-amber-500/10 text-amber-700 border-amber-200",
  delayed: "bg-red-500/10 text-red-700 border-red-200",
  completed: "bg-slate-500/10 text-slate-600 border-slate-200",
};

const taskStatusColors: Record<string, string> = {
  todo: "bg-slate-100 text-slate-700",
  in_progress: "bg-blue-100 text-blue-700",
  done: "bg-emerald-100 text-emerald-700",
  overdue: "bg-red-100 text-red-700",
};

export default function ProjectDetail() {
  const params = useParams<{ id: string }>();
  const projectId = Number(params.id);
  const [, setLocation] = useLocation();
  const [noteContent, setNoteContent] = useState("");
  const [noteClientVisible, setNoteClientVisible] = useState(false);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [fileCategory, setFileCategory] = useState<string>("other");

  const { data: project, isLoading } = trpc.projects.get.useQuery({ id: projectId });
  const { data: projectTasks } = trpc.tasks.list.useQuery({ projectId });
  const { data: notes } = trpc.notes.list.useQuery({ projectId });
  const { data: projectFiles } = trpc.files.list.useQuery({ projectId });
  const { data: teamMembers } = trpc.teamMembers.list.useQuery();
  const utils = trpc.useUtils();

  const updateProject = trpc.projects.update.useMutation({
    onSuccess: () => {
      utils.projects.get.invalidate({ id: projectId });
      utils.projects.list.invalidate();
      toast.success("Project updated");
    },
  });

  const createTask = trpc.tasks.create.useMutation({
    onSuccess: () => {
      utils.tasks.list.invalidate({ projectId });
      setTaskDialogOpen(false);
      toast.success("Task created");
    },
  });

  const createNote = trpc.notes.create.useMutation({
    onSuccess: () => {
      utils.notes.list.invalidate({ projectId });
      setNoteContent("");
      setNoteClientVisible(false);
      toast.success("Note added");
    },
  });

  const deleteNote = trpc.notes.delete.useMutation({
    onSuccess: () => {
      utils.notes.list.invalidate({ projectId });
      toast.success("Note deleted");
    },
  });

  const updateTask = trpc.tasks.update.useMutation({
    onSuccess: () => {
      utils.tasks.list.invalidate({ projectId });
    },
  });

  const uploadFile = trpc.files.upload.useMutation({
    onSuccess: () => {
      utils.files.list.invalidate({ projectId });
      setUploadingFile(false);
      toast.success("File uploaded successfully");
    },
    onError: (err) => {
      setUploadingFile(false);
      toast.error("Upload failed: " + err.message);
    },
  });

  const deleteFile = trpc.files.delete.useMutation({
    onSuccess: () => {
      utils.files.list.invalidate({ projectId });
      toast.success("File deleted");
    },
  });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File size must be under 10MB");
      return;
    }
    setUploadingFile(true);
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      if (!base64) { setUploadingFile(false); return; }
      uploadFile.mutate({
        projectId,
        fileName: file.name,
        fileData: base64,
        mimeType: file.type,
        fileSize: file.size,
        category: fileCategory as any,
      });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const getFileIcon = (mimeType?: string | null) => {
    if (!mimeType) return <File className="h-4 w-4" />;
    if (mimeType.startsWith("image/")) return <ImageIcon className="h-4 w-4" />;
    if (mimeType.includes("pdf")) return <FileText className="h-4 w-4 text-red-500" />;
    return <File className="h-4 w-4" />;
  };

  const formatFileSize = (bytes?: number | null) => {
    if (!bytes) return "";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  const FILE_CATEGORIES = [
    { value: "drawing", label: "Drawing" },
    { value: "specification", label: "Specification" },
    { value: "correspondence", label: "Correspondence" },
    { value: "photo", label: "Photo" },
    { value: "contract", label: "Contract" },
    { value: "other", label: "Other" },
  ];

  const getMemberName = (id: number | null) =>
    teamMembers?.find((m) => m.id === id)?.name ?? "Unassigned";

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Skeleton className="h-96 rounded-xl lg:col-span-2" />
          <Skeleton className="h-96 rounded-xl" />
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
        <h2 className="text-xl font-semibold">Project not found</h2>
        <Button variant="outline" onClick={() => setLocation("/projects")}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Back to Projects
        </Button>
      </div>
    );
  }

  const billingMilestones = [
    { label: "25%", key: "billing25" as const, reached: project.billing25 },
    { label: "50%", key: "billing50" as const, reached: project.billing50 },
    { label: "75%", key: "billing75" as const, reached: project.billing75 },
    { label: "100%", key: "billing100" as const, reached: project.billing100 },
  ];

  const currentPhaseIndex = PROJECT_PHASES.findIndex((p) => p.value === project.phase);

  const handleTaskCreate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    createTask.mutate({
      projectId,
      title: fd.get("title") as string,
      assigneeId: fd.get("assigneeId") ? Number(fd.get("assigneeId")) : undefined,
      priority: fd.get("priority") ? Number(fd.get("priority")) : 10,
      deadline: fd.get("deadline") ? new Date(fd.get("deadline") as string) : undefined,
      description: (fd.get("description") as string) || undefined,
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/projects")} className="mt-0.5 shrink-0">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{project.name}</h1>
            <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground flex-wrap">
              {project.clientName && <span>{project.clientName}</span>}
              {project.address && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3 w-3" /> {project.address}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Select
            value={project.status}
            onValueChange={(v) => updateProject.mutate({ id: projectId, status: v as any })}
          >
            <SelectTrigger className={`w-[130px] text-xs ${statusColorMap[project.status] ?? ""}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROJECT_STATUSES.map((s) => (
                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Phase Progression */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Project Phase</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-1 overflow-x-auto pb-2">
                {PROJECT_PHASES.map((phase, i) => {
                  const isCurrent = i === currentPhaseIndex;
                  const isPast = i < currentPhaseIndex;
                  return (
                    <button
                      key={phase.value}
                      onClick={() => updateProject.mutate({ id: projectId, phase: phase.value as any })}
                      className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
                        isCurrent
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : isPast
                          ? "bg-primary/10 text-primary"
                          : "bg-muted text-muted-foreground hover:bg-muted/80"
                      }`}
                    >
                      {isPast ? (
                        <CheckCircle2 className="h-3 w-3" />
                      ) : (
                        <span className="h-4 w-4 rounded-full border-2 flex items-center justify-center text-[9px] shrink-0" style={{ borderColor: isCurrent ? "currentColor" : "currentColor" }}>
                          {i + 1}
                        </span>
                      )}
                      {phase.shortLabel}
                    </button>
                  );
                })}
              </div>
              <div className="mt-4">
                <div className="flex items-center justify-between text-sm mb-2">
                  <span className="text-muted-foreground">Overall Completion</span>
                  <span className="font-semibold">{project.completionPercentage}%</span>
                </div>
                <Progress value={project.completionPercentage} className="h-2" />
                <div className="flex items-center gap-2 mt-3">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    defaultValue={project.completionPercentage}
                    className="w-20 h-8 text-sm"
                    onBlur={(e) => {
                      const val = Math.min(100, Math.max(0, Number(e.target.value)));
                      if (val !== project.completionPercentage) {
                        updateProject.mutate({ id: projectId, completionPercentage: val });
                      }
                    }}
                  />
                  <span className="text-xs text-muted-foreground">% complete</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Tasks */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-base font-semibold">
                Tasks ({projectTasks?.length ?? 0})
              </CardTitle>
              <Dialog open={taskDialogOpen} onOpenChange={setTaskDialogOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="outline">
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add Task
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Add Task</DialogTitle>
                  </DialogHeader>
                  <form onSubmit={handleTaskCreate} className="space-y-4">
                    <div className="space-y-2">
                      <Label>Task Title</Label>
                      <Input name="title" placeholder="e.g., Complete floor plan review" required />
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
                      <Button type="button" variant="outline" onClick={() => setTaskDialogOpen(false)}>Cancel</Button>
                      <Button type="submit" disabled={createTask.isPending}>
                        {createTask.isPending ? "Adding..." : "Add Task"}
                      </Button>
                    </div>
                  </form>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent className="p-0">
              {!projectTasks || projectTasks.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  No tasks yet. Add your first task to get started.
                </div>
              ) : (
                <div className="divide-y">
                  {projectTasks.map((task) => {
                    const isOverdue = task.deadline && new Date(task.deadline) < new Date() && task.status !== "done";
                    return (
                      <div key={task.id} className="flex items-center gap-3 px-6 py-3 hover:bg-muted/30 transition-colors">
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
                            <Circle className={`h-5 w-5 ${isOverdue ? "text-red-400" : "text-muted-foreground/40"}`} />
                          )}
                        </button>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm ${task.status === "done" ? "line-through text-muted-foreground" : ""}`}>
                            {task.title}
                          </p>
                          <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                            <span>{getMemberName(task.assigneeId)}</span>
                            {task.deadline && (
                              <span className={`flex items-center gap-1 ${isOverdue ? "text-red-500 font-medium" : ""}`}>
                                <Clock className="h-3 w-3" />
                                {new Date(task.deadline).toLocaleDateString()}
                              </span>
                            )}
                          </div>
                        </div>
                        <Badge variant="outline" className="text-[10px] shrink-0">
                          P{task.priority}
                        </Badge>
                        <Badge className={`text-[10px] shrink-0 border-0 ${taskStatusColors[task.status] ?? ""}`}>
                          {task.status === "in_progress" ? "In Progress" : task.status.charAt(0).toUpperCase() + task.status.slice(1)}
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* File Attachments */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Paperclip className="h-4 w-4 text-muted-foreground" />
                Files & Documents ({projectFiles?.length ?? 0})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Upload area */}
              <div className="border-2 border-dashed border-border/60 rounded-lg p-4 text-center hover:border-primary/40 transition-colors">
                <div className="flex items-center justify-center gap-3">
                  <Select value={fileCategory} onValueChange={setFileCategory}>
                    <SelectTrigger className="w-[140px] h-8 text-xs">
                      <SelectValue placeholder="Category" />
                    </SelectTrigger>
                    <SelectContent>
                      {FILE_CATEGORIES.map(c => (
                        <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <label className="cursor-pointer">
                    <input
                      type="file"
                      className="hidden"
                      onChange={handleFileUpload}
                      disabled={uploadingFile}
                    />
                    <Button variant="outline" size="sm" asChild disabled={uploadingFile}>
                      <span>
                        <Upload className="h-3.5 w-3.5 mr-1.5" />
                        {uploadingFile ? "Uploading..." : "Upload File"}
                      </span>
                    </Button>
                  </label>
                </div>
                <p className="text-[10px] text-muted-foreground mt-2">Max 10MB per file. Drawings, specs, correspondence, photos, contracts.</p>
              </div>

              {/* File list */}
              {!projectFiles || projectFiles.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No files attached yet</p>
              ) : (
                <div className="space-y-2">
                  {projectFiles.map((file) => (
                    <div key={file.id} className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors group">
                      {getFileIcon(file.mimeType)}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{file.fileName}</p>
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">{file.category}</Badge>
                          <span>{formatFileSize(file.fileSize)}</span>
                          <span>{new Date(file.createdAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
                          <a href={file.url} target="_blank" rel="noopener noreferrer">
                            <Download className="h-3.5 w-3.5" />
                          </a>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => deleteFile.mutate({ id: file.id })}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Notes */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-muted-foreground" />
                Project Notes
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <Textarea
                  placeholder="Add a note about this project..."
                  value={noteContent}
                  onChange={(e) => setNoteContent(e.target.value)}
                  rows={3}
                />
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={noteClientVisible}
                      onCheckedChange={setNoteClientVisible}
                      id="client-visible"
                    />
                    <Label htmlFor="client-visible" className="text-xs text-muted-foreground">
                      Visible to client
                    </Label>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => {
                      if (noteContent.trim()) {
                        createNote.mutate({
                          projectId,
                          content: noteContent.trim(),
                          isClientVisible: noteClientVisible,
                        });
                      }
                    }}
                    disabled={!noteContent.trim() || createNote.isPending}
                  >
                    Add Note
                  </Button>
                </div>
              </div>
              <Separator />
              {!notes || notes.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No notes yet</p>
              ) : (
                <div className="space-y-3">
                  {notes.map((note) => (
                    <div key={note.id} className="bg-muted/50 rounded-lg p-4 relative group">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm whitespace-pre-wrap">{note.content}</p>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                          onClick={() => deleteNote.mutate({ id: note.id })}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      </div>
                      <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                        <span>{new Date(note.createdAt).toLocaleDateString()}</span>
                        {note.isClientVisible ? (
                          <span className="flex items-center gap-1 text-primary">
                            <Eye className="h-3 w-3" /> Client visible
                          </span>
                        ) : (
                          <span className="flex items-center gap-1">
                            <EyeOff className="h-3 w-3" /> Internal only
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Project Info */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Project Manager</span>
                  <Select
                    value={project.projectManagerId?.toString() ?? "none"}
                    onValueChange={(v) =>
                      updateProject.mutate({
                        id: projectId,
                        projectManagerId: v === "none" ? null : Number(v),
                      })
                    }
                  >
                    <SelectTrigger className="w-[140px] h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Unassigned</SelectItem>
                      {teamMembers?.map((m) => (
                        <SelectItem key={m.id} value={m.id.toString()}>{m.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Phase</span>
                  <span className="text-sm font-medium">{getPhaseLabel(project.phase)}</span>
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Start Date</span>
                  <span className="text-sm">
                    {project.startDate ? new Date(project.startDate).toLocaleDateString() : "Not set"}
                  </span>
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Deadline</span>
                  <span className="text-sm">
                    {project.deadline ? new Date(project.deadline).toLocaleDateString() : "Not set"}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Billing Milestones */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
                  Billing Milestones
                </CardTitle>
                <Badge
                  variant={project.billingOk ? "default" : "outline"}
                  className={project.billingOk ? "bg-emerald-500 text-white" : "text-amber-600 border-amber-300"}
                >
                  {project.billingOk ? "Billing OK" : "Review Needed"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {billingMilestones.map((ms) => (
                  <button
                    key={ms.key}
                    onClick={() => updateProject.mutate({ id: projectId, [ms.key]: !ms.reached })}
                    className="flex items-center gap-3 w-full p-2.5 rounded-lg hover:bg-muted/50 transition-colors"
                  >
                    {ms.reached ? (
                      <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
                    ) : (
                      <Circle className="h-5 w-5 text-muted-foreground/30 shrink-0" />
                    )}
                    <span className={`text-sm ${ms.reached ? "font-medium" : "text-muted-foreground"}`}>
                      {ms.label} Milestone
                    </span>
                    <div className="flex-1" />
                    <div className={`h-1.5 w-8 rounded-full ${ms.reached ? "bg-emerald-500" : "bg-muted"}`} />
                  </button>
                ))}
              </div>
              <Separator className="my-3" />
              <button
                onClick={() => updateProject.mutate({ id: projectId, billingOk: !project.billingOk })}
                className="flex items-center gap-3 w-full p-2.5 rounded-lg hover:bg-muted/50 transition-colors"
              >
                <div className={`h-3 w-3 rounded-full ${project.billingOk ? "bg-emerald-500" : "bg-amber-500"}`} />
                <span className="text-sm font-medium">Billing Status</span>
                <div className="flex-1" />
                <Switch checked={project.billingOk} />
              </button>
            </CardContent>
          </Card>

          {/* Description */}
          {project.description && (
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold">Description</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground leading-relaxed">{project.description}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
