import { useState, useRef } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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
  Share2,
  Link2,
  Copy,
  ExternalLink,
  Pencil,
  Check,
  RotateCcw,
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

const taskStatusOptions = [
  { value: "todo", label: "To Do" },
  { value: "in_progress", label: "In Progress" },
  { value: "done", label: "Done" },
  { value: "overdue", label: "Overdue" },
];

export default function ProjectDetail() {
  const params = useParams<{ id: string }>();
  const projectId = Number(params.id);
  const [, setLocation] = useLocation();
  const [noteContent, setNoteContent] = useState("");
  const [noteClientVisible, setNoteClientVisible] = useState(false);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<number | null>(null);
  const [editTaskData, setEditTaskData] = useState<any>(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [fileCategory, setFileCategory] = useState<string>("other");
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [editingProjectDates, setEditingProjectDates] = useState(false);
  const [editStartDate, setEditStartDate] = useState("");
  const [editDeadline, setEditDeadline] = useState("");
  const [editingDescription, setEditingDescription] = useState(false);
  const [editDescription, setEditDescription] = useState("");
  const [editingFee, setEditingFee] = useState(false);
  const [editFeeValue, setEditFeeValue] = useState("");
  const [invoiceDialogOpen, setInvoiceDialogOpen] = useState(false);
  const [consultantDialogOpen, setConsultantDialogOpen] = useState(false);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState<number | null>(null);
  const [expandedConsultant, setExpandedConsultant] = useState<number | null>(null);
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const { data: project, isLoading } = trpc.projects.get.useQuery({ id: projectId });
  const { data: projectTasks } = trpc.tasks.list.useQuery({ projectId });
  const { data: notes } = trpc.notes.list.useQuery({ projectId });
  const { data: projectFiles } = trpc.files.list.useQuery({ projectId });
  const { data: teamMembers } = trpc.teamMembers.list.useQuery();
  const { data: shareTokens } = trpc.shareTokens.list.useQuery({ projectId });
  const { data: projectInvoices } = trpc.invoices.list.useQuery({ projectId });
  const { data: consultants } = trpc.consultants.list.useQuery({ projectId });
  const { data: netIncomeData } = trpc.netIncome.project.useQuery({ projectId });
  const utils = trpc.useUtils();

  const updateProject = trpc.projects.update.useMutation({
    onSuccess: () => {
      utils.projects.get.invalidate({ id: projectId });
      utils.projects.list.invalidate();
      toast.success("Project updated");
    },
  });

  const deleteProject = trpc.projects.delete.useMutation({
    onSuccess: () => {
      toast.success("Project deleted");
      setLocation("/projects");
    },
  });

  const createTask = trpc.tasks.create.useMutation({
    onSuccess: () => {
      utils.tasks.list.invalidate({ projectId });
      setTaskDialogOpen(false);
      toast.success("Task created");
    },
  });

  const updateTask = trpc.tasks.update.useMutation({
    onSuccess: () => {
      utils.tasks.list.invalidate({ projectId });
      setEditingTaskId(null);
      setEditTaskData(null);
    },
  });

  const deleteTask = trpc.tasks.delete.useMutation({
    onSuccess: () => {
      utils.tasks.list.invalidate({ projectId });
      toast.success("Task deleted");
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

  const createConsultant = trpc.consultants.create.useMutation({
    onSuccess: () => {
      utils.consultants.list.invalidate({ projectId });
      utils.netIncome.project.invalidate({ projectId });
      setConsultantDialogOpen(false);
      toast.success("Consultant added");
    },
  });

  const updateConsultant = trpc.consultants.update.useMutation({
    onSuccess: () => {
      utils.consultants.list.invalidate({ projectId });
      utils.netIncome.project.invalidate({ projectId });
      toast.success("Consultant updated");
    },
  });

  const deleteConsultant = trpc.consultants.delete.useMutation({
    onSuccess: () => {
      utils.consultants.list.invalidate({ projectId });
      utils.netIncome.project.invalidate({ projectId });
      toast.success("Consultant removed");
    },
  });

  const createPayment = trpc.consultantPayments.create.useMutation({
    onSuccess: () => {
      utils.consultants.list.invalidate({ projectId });
      utils.netIncome.project.invalidate({ projectId });
      setPaymentDialogOpen(null);
      toast.success("Payment recorded");
    },
  });

  const deletePayment = trpc.consultantPayments.delete.useMutation({
    onSuccess: () => {
      utils.consultants.list.invalidate({ projectId });
      utils.netIncome.project.invalidate({ projectId });
      toast.success("Payment deleted");
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

  const createInvoice = trpc.invoices.create.useMutation({
    onSuccess: () => {
      utils.invoices.list.invalidate({ projectId });
      utils.projects.get.invalidate({ id: projectId });
      setInvoiceDialogOpen(false);
      toast.success("Invoice created");
    },
  });

  const updateInvoice = trpc.invoices.update.useMutation({
    onSuccess: () => {
      utils.invoices.list.invalidate({ projectId });
      utils.projects.get.invalidate({ id: projectId });
      toast.success("Invoice updated");
    },
  });

  const deleteInvoice = trpc.invoices.delete.useMutation({
    onSuccess: () => {
      utils.invoices.list.invalidate({ projectId });
      utils.projects.get.invalidate({ id: projectId });
      toast.success("Invoice deleted");
    },
  });

  const createShareToken = trpc.shareTokens.create.useMutation({
    onSuccess: () => {
      utils.shareTokens.list.invalidate({ projectId });
      toast.success("Share link created");
    },
  });

  const revokeShareToken = trpc.shareTokens.revoke.useMutation({
    onSuccess: () => {
      utils.shareTokens.list.invalidate({ projectId });
      toast.success("Share link revoked");
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

  const copyShareLink = (token: string) => {
    const url = `${window.location.origin}/portal/${token}`;
    navigator.clipboard.writeText(url);
    toast.success("Link copied to clipboard");
  };

  const formatDate = (d: Date | string | null | undefined) => {
    if (!d) return "";
    const date = new Date(d);
    return date.toISOString().split("T")[0];
  };

  const startEditTask = (task: any) => {
    setEditingTaskId(task.id);
    setEditTaskData({
      title: task.title,
      assigneeId: task.assigneeId,
      priority: task.priority,
      deadline: task.deadline ? formatDate(task.deadline) : "",
      status: task.status,
      description: task.description || "",
    });
  };

  const saveEditTask = () => {
    if (!editTaskData || !editingTaskId) return;
    updateTask.mutate({
      id: editingTaskId,
      title: editTaskData.title,
      assigneeId: editTaskData.assigneeId || null,
      priority: Number(editTaskData.priority),
      deadline: editTaskData.deadline ? new Date(editTaskData.deadline) : null,
      status: editTaskData.status,
      completedAt: editTaskData.status === "done" ? new Date() : null,
    });
    toast.success("Task updated");
  };

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
          {/* Share button */}
          <Dialog open={shareDialogOpen} onOpenChange={setShareDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Share2 className="h-3.5 w-3.5 mr-1.5" /> Share with Client
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Link2 className="h-5 w-5" /> Client Portal Links
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Generate a read-only link for your client. They can view project progress, milestones, client-visible notes, and shared documents — no login required.
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => createShareToken.mutate({ projectId, label: "Client Link" })}
                    disabled={createShareToken.isPending}
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    {createShareToken.isPending ? "Creating..." : "Generate New Link"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => createShareToken.mutate({ projectId, label: "Expiring Link", expiresInDays: 30 })}
                    disabled={createShareToken.isPending}
                  >
                    <Clock className="h-3.5 w-3.5 mr-1" /> 30-Day Link
                  </Button>
                </div>
                <Separator />
                {!shareTokens || shareTokens.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No share links yet. Generate one above.
                  </p>
                ) : (
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {shareTokens.map((st: any) => (
                      <div key={st.id} className={`flex items-center gap-2 p-3 rounded-lg border ${st.isActive ? "bg-muted/30" : "bg-muted/10 opacity-50"}`}>
                        <Link2 className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{st.label || "Share Link"}</p>
                          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                            <span>Created {new Date(st.createdAt).toLocaleDateString()}</span>
                            {st.expiresAt && (
                              <span className="text-amber-600">
                                Expires {new Date(st.expiresAt).toLocaleDateString()}
                              </span>
                            )}
                            {!st.isActive && <Badge variant="outline" className="text-[10px] text-red-500 border-red-200">Revoked</Badge>}
                          </div>
                        </div>
                        {st.isActive && (
                          <>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => copyShareLink(st.token)}>
                                  <Copy className="h-3.5 w-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Copy link</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
                                  <a href={`/portal/${st.token}`} target="_blank" rel="noopener noreferrer">
                                    <ExternalLink className="h-3.5 w-3.5" />
                                  </a>
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Open portal</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-red-500 hover:text-red-600"
                                  onClick={() => revokeShareToken.mutate({ id: st.id })}
                                >
                                  <X className="h-3.5 w-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Revoke link</TooltipContent>
                            </Tooltip>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </DialogContent>
          </Dialog>

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
                    <Tooltip key={phase.value}>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => updateProject.mutate({ id: projectId, phase: phase.value as any })}
                          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all hover:scale-105 ${
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
                            <span className="h-4 w-4 rounded-full border-2 flex items-center justify-center text-[9px] shrink-0" style={{ borderColor: "currentColor" }}>
                              {i + 1}
                            </span>
                          )}
                          {phase.shortLabel}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>Click to set phase to {phase.label}</TooltipContent>
                    </Tooltip>
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
                    const isEditing = editingTaskId === task.id;

                    if (isEditing && editTaskData) {
                      return (
                        <div key={task.id} className="px-6 py-4 bg-primary/5 border-l-2 border-primary space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-primary uppercase tracking-wider">Editing Task</span>
                            <div className="flex items-center gap-1">
                              <Button size="sm" variant="ghost" onClick={() => { setEditingTaskId(null); setEditTaskData(null); }}>
                                <X className="h-3.5 w-3.5 mr-1" /> Cancel
                              </Button>
                              <Button size="sm" onClick={saveEditTask} disabled={updateTask.isPending}>
                                <Check className="h-3.5 w-3.5 mr-1" /> Save
                              </Button>
                            </div>
                          </div>
                          <Input
                            value={editTaskData.title}
                            onChange={(e) => setEditTaskData({ ...editTaskData, title: e.target.value })}
                            className="font-medium"
                            placeholder="Task title"
                          />
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            <div className="space-y-1">
                              <Label className="text-[10px] text-muted-foreground uppercase">Assignee</Label>
                              <select
                                value={editTaskData.assigneeId || ""}
                                onChange={(e) => setEditTaskData({ ...editTaskData, assigneeId: e.target.value ? Number(e.target.value) : null })}
                                className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs"
                              >
                                <option value="">Unassigned</option>
                                {teamMembers?.map((m) => (
                                  <option key={m.id} value={m.id}>{m.name}</option>
                                ))}
                              </select>
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[10px] text-muted-foreground uppercase">Priority</Label>
                              <Input
                                type="number"
                                min={1}
                                max={20}
                                value={editTaskData.priority}
                                onChange={(e) => setEditTaskData({ ...editTaskData, priority: Number(e.target.value) })}
                                className="h-8 text-xs"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[10px] text-muted-foreground uppercase">Deadline</Label>
                              <Input
                                type="date"
                                value={editTaskData.deadline}
                                onChange={(e) => setEditTaskData({ ...editTaskData, deadline: e.target.value })}
                                className="h-8 text-xs"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[10px] text-muted-foreground uppercase">Status</Label>
                              <select
                                value={editTaskData.status}
                                onChange={(e) => setEditTaskData({ ...editTaskData, status: e.target.value })}
                                className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs"
                              >
                                {taskStatusOptions.map((s) => (
                                  <option key={s.value} value={s.value}>{s.label}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div key={task.id} className="flex items-center gap-3 px-6 py-3.5 hover:bg-muted/30 transition-colors">
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
                          <p className={`text-sm font-medium ${task.status === "done" ? "line-through text-muted-foreground" : ""}`}>
                            {task.title}
                          </p>
                          <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <User className="h-3 w-3" />
                              {getMemberName(task.assigneeId)}
                            </span>
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
                        {/* Edit & Delete buttons - ALWAYS VISIBLE */}
                        <div className="flex items-center gap-0.5 shrink-0">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-xs gap-1 border-primary/20 text-primary hover:bg-primary/10 hover:text-primary"
                            onClick={() => startEditTask(task)}
                          >
                            <Pencil className="h-3 w-3" />
                            Edit
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-red-500">
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete Task</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Are you sure you want to delete "{task.title}"? This action cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => deleteTask.mutate({ id: task.id })} className="bg-red-500 hover:bg-red-600">
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
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
                    <input type="file" className="hidden" onChange={handleFileUpload} disabled={uploadingFile} />
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
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deleteFile.mutate({ id: file.id })}>
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
                    <Switch checked={noteClientVisible} onCheckedChange={setNoteClientVisible} id="client-visible" />
                    <Label htmlFor="client-visible" className="text-xs text-muted-foreground">
                      Visible to client
                    </Label>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => {
                      if (noteContent.trim()) {
                        createNote.mutate({ projectId, content: noteContent.trim(), isClientVisible: noteClientVisible });
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
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold">Details</CardTitle>
                {!editingProjectDates ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => {
                          setEditingProjectDates(true);
                          setEditStartDate(formatDate(project.startDate));
                          setEditDeadline(formatDate(project.deadline));
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Edit dates</TooltipContent>
                  </Tooltip>
                ) : (
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingProjectDates(false)}>
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => {
                        updateProject.mutate({
                          id: projectId,
                          startDate: editStartDate ? new Date(editStartDate) : null,
                          deadline: editDeadline ? new Date(editDeadline) : null,
                        });
                        setEditingProjectDates(false);
                      }}
                    >
                      Save
                    </Button>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Project Manager</span>
                  <Select
                    value={project.projectManagerId?.toString() ?? "none"}
                    onValueChange={(v) =>
                      updateProject.mutate({ id: projectId, projectManagerId: v === "none" ? null : Number(v) })
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
                  {editingProjectDates ? (
                    <Input
                      type="date"
                      value={editStartDate}
                      onChange={(e) => setEditStartDate(e.target.value)}
                      className="w-[140px] h-8 text-xs"
                    />
                  ) : (
                    <span className="text-sm">
                      {project.startDate ? new Date(project.startDate).toLocaleDateString() : "Not set"}
                    </span>
                  )}
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Deadline</span>
                  {editingProjectDates ? (
                    <Input
                      type="date"
                      value={editDeadline}
                      onChange={(e) => setEditDeadline(e.target.value)}
                      className="w-[140px] h-8 text-xs"
                    />
                  ) : (
                    <span className="text-sm">
                      {project.deadline ? new Date(project.deadline).toLocaleDateString() : "Not set"}
                    </span>
                  )}
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

          {/* Budget & Invoices */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-muted-foreground" />
                Budget & Invoices
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Contracted Fee</span>
                {editingFee && isAdmin ? (
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-muted-foreground">$</span>
                    <Input type="number" value={editFeeValue} onChange={(e) => setEditFeeValue(e.target.value)} className="w-28 h-8 text-xs" min={0} step={100} />
                    <Button size="sm" className="h-7 text-xs" onClick={() => { updateProject.mutate({ id: projectId, contractedFee: Math.round(Number(editFeeValue) * 100) }); setEditingFee(false); }}>Save</Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingFee(false)}>Cancel</Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1">
                    <span className="text-sm font-semibold">{project.contractedFee > 0 ? `$${(project.contractedFee / 100).toLocaleString()}` : "Not set"}</span>
                    {isAdmin && <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setEditingFee(true); setEditFeeValue((project.contractedFee / 100).toString()); }}><Pencil className="h-3 w-3 text-muted-foreground" /></Button>}
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Collected</span>
                <span className="text-sm font-medium text-emerald-600">${(project.invoicedAmount / 100).toLocaleString()}</span>
              </div>
              {project.contractedFee > 0 && <Progress value={Math.min((project.invoicedAmount / project.contractedFee) * 100, 100)} className="h-2" />}
              <Separator />
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Invoices</span>
                {isAdmin && (
                  <Dialog open={invoiceDialogOpen} onOpenChange={setInvoiceDialogOpen}>
                    <DialogTrigger asChild>
                      <Button variant="outline" size="sm" className="h-7 text-xs"><Plus className="h-3 w-3 mr-1" /> New Invoice</Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader><DialogTitle>Create Invoice</DialogTitle></DialogHeader>
                      <form onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); createInvoice.mutate({ projectId, amount: Math.round(Number(fd.get("amount")) * 100), invoiceNumber: (fd.get("invoiceNumber") as string) || undefined, description: (fd.get("description") as string) || undefined, status: (fd.get("status") as any) || "draft", invoiceDate: fd.get("invoiceDate") ? new Date(fd.get("invoiceDate") as string) : undefined, dueDate: fd.get("dueDate") ? new Date(fd.get("dueDate") as string) : null }); }} className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2"><Label>Amount ($)</Label><Input name="amount" type="number" min={0} step={0.01} required placeholder="0.00" /></div>
                          <div className="space-y-2"><Label>Invoice #</Label><Input name="invoiceNumber" placeholder="INV-001" /></div>
                        </div>
                        <div className="space-y-2"><Label>Description</Label><Input name="description" placeholder="25% milestone payment" /></div>
                        <div className="grid grid-cols-3 gap-3">
                          <div className="space-y-2"><Label>Status</Label><select name="status" className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"><option value="draft">Draft</option><option value="sent">Sent</option><option value="paid">Paid</option></select></div>
                          <div className="space-y-2"><Label>Date</Label><Input name="invoiceDate" type="date" defaultValue={new Date().toISOString().split('T')[0]} /></div>
                          <div className="space-y-2"><Label>Due Date</Label><Input name="dueDate" type="date" /></div>
                        </div>
                        <DialogFooter>
                          <Button type="button" variant="outline" onClick={() => setInvoiceDialogOpen(false)}>Cancel</Button>
                          <Button type="submit" disabled={createInvoice.isPending}>{createInvoice.isPending ? "Creating..." : "Create Invoice"}</Button>
                        </DialogFooter>
                      </form>
                    </DialogContent>
                  </Dialog>
                )}
              </div>
              {!projectInvoices || projectInvoices.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-2">No invoices yet</p>
              ) : (
                <div className="space-y-2">
                  {projectInvoices.map((inv: any) => {
                    const sc = inv.status === "paid" ? "bg-emerald-100 text-emerald-700" : inv.status === "sent" ? "bg-blue-100 text-blue-700" : inv.status === "overdue" ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-600";
                    return (
                      <div key={inv.id} className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors group">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2"><span className="text-sm font-medium">${(inv.amount / 100).toLocaleString()}</span><Badge className={`text-[10px] border-0 ${sc}`}>{inv.status.charAt(0).toUpperCase() + inv.status.slice(1)}</Badge></div>
                          <p className="text-[10px] text-muted-foreground truncate">{inv.invoiceNumber && `${inv.invoiceNumber} \u00b7 `}{inv.description || "No description"}</p>
                        </div>
                        {isAdmin && inv.status !== "paid" && <Button variant="ghost" size="sm" className="h-6 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity text-emerald-600" onClick={() => updateInvoice.mutate({ id: inv.id, status: "paid", paidDate: new Date() })}>Mark Paid</Button>}
                        {isAdmin && <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => deleteInvoice.mutate({ id: inv.id })}><Trash2 className="h-3 w-3 text-muted-foreground" /></Button>}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Consultant Contracts & Payments */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <User className="h-4 w-4 text-muted-foreground" />
                  Consultants
                </CardTitle>
                {isAdmin && (
                  <Dialog open={consultantDialogOpen} onOpenChange={setConsultantDialogOpen}>
                    <DialogTrigger asChild>
                      <Button variant="outline" size="sm" className="h-7 text-xs"><Plus className="h-3 w-3 mr-1" /> Add Consultant</Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader><DialogTitle>Add Consultant</DialogTitle></DialogHeader>
                      <form onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); createConsultant.mutate({ projectId, name: fd.get("name") as string, discipline: fd.get("discipline") as string, contractAmount: Math.round(Number(fd.get("contractAmount")) * 100), status: (fd.get("status") as any) || "active", notes: (fd.get("notes") as string) || undefined }); }} className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2"><Label>Firm Name</Label><Input name="name" required placeholder="e.g., Thornton Engineering" /></div>
                          <div className="space-y-2"><Label>Discipline</Label><Input name="discipline" required placeholder="e.g., Structural Engineer" /></div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2"><Label>Contract Amount ($)</Label><Input name="contractAmount" type="number" min={0} step={0.01} required placeholder="0.00" /></div>
                          <div className="space-y-2"><Label>Status</Label><select name="status" className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"><option value="active">Active</option><option value="pending">Pending</option><option value="completed">Completed</option><option value="terminated">Terminated</option></select></div>
                        </div>
                        <div className="space-y-2"><Label>Notes</Label><Input name="notes" placeholder="Optional notes" /></div>
                        <DialogFooter>
                          <Button type="button" variant="outline" onClick={() => setConsultantDialogOpen(false)}>Cancel</Button>
                          <Button type="submit" disabled={createConsultant.isPending}>{createConsultant.isPending ? "Adding..." : "Add Consultant"}</Button>
                        </DialogFooter>
                      </form>
                    </DialogContent>
                  </Dialog>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {!consultants || consultants.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-2">No consultants added yet</p>
              ) : (
                <div className="space-y-2">
                  {consultants.map((c: any) => {
                    const isExpanded = expandedConsultant === c.id;
                    const statusColor = c.status === "active" ? "bg-emerald-100 text-emerald-700" : c.status === "completed" ? "bg-blue-100 text-blue-700" : c.status === "terminated" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700";
                    return (
                      <div key={c.id} className="rounded-lg border border-border/50 overflow-hidden">
                        <div className="flex items-center gap-2 p-3 cursor-pointer hover:bg-muted/30 transition-colors" onClick={() => setExpandedConsultant(isExpanded ? null : c.id)}>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium truncate">{c.name}</span>
                              <Badge className={`text-[10px] border-0 ${statusColor}`}>{c.status.charAt(0).toUpperCase() + c.status.slice(1)}</Badge>
                            </div>
                            <p className="text-[11px] text-muted-foreground">{c.discipline}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-semibold">${(c.contractAmount / 100).toLocaleString()}</p>
                          </div>
                        </div>
                        {isExpanded && (
                          <ConsultantExpanded consultant={c} projectId={projectId} isAdmin={isAdmin} paymentDialogOpen={paymentDialogOpen} setPaymentDialogOpen={setPaymentDialogOpen} createPayment={createPayment} deletePayment={deletePayment} updateConsultant={updateConsultant} deleteConsultant={deleteConsultant} />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Net Income Summary */}
              {netIncomeData && (
                <>
                  <Separator />
                  <div className="space-y-2 pt-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Net Income</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Fees Collected</span>
                      <span className="text-xs font-medium text-emerald-600">${(netIncomeData.feesCollected / 100).toLocaleString()}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Consultant Payments</span>
                      <span className="text-xs font-medium text-red-500">-${(netIncomeData.consultantPaymentsTotal / 100).toLocaleString()}</span>
                    </div>
                    <Separator />
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold">Net Income</span>
                      <span className={`text-sm font-bold ${netIncomeData.netIncome >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {netIncomeData.netIncome >= 0 ? '' : '-'}${Math.abs(netIncomeData.netIncome / 100).toLocaleString()}
                      </span>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Description */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold">Description</CardTitle>
                {!editingDescription ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => {
                          setEditingDescription(true);
                          setEditDescription(project.description || "");
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Edit description</TooltipContent>
                  </Tooltip>
                ) : (
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingDescription(false)}>
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => {
                        updateProject.mutate({ id: projectId, description: editDescription || null });
                        setEditingDescription(false);
                      }}
                    >
                      Save
                    </Button>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {editingDescription ? (
                <Textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  rows={4}
                  placeholder="Add a project description..."
                />
              ) : (
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {project.description || "No description yet. Click the pencil icon to add one."}
                </p>
              )}
            </CardContent>
          </Card>

          {/* Delete Project */}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" className="w-full text-red-500 border-red-200 hover:bg-red-50 hover:text-red-600">
                <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete Project
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Project</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to delete "{project.name}"? This will permanently remove the project, all its tasks, notes, and files. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => deleteProject.mutate({ id: projectId })} className="bg-red-500 hover:bg-red-600">
                  Delete Project
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </div>
  );
}


function ConsultantExpanded({ consultant, projectId, isAdmin, paymentDialogOpen, setPaymentDialogOpen, createPayment, deletePayment, updateConsultant, deleteConsultant }: any) {
  const { data: payments, isLoading } = trpc.consultantPayments.list.useQuery({ consultantId: consultant.id });
  const totalPaid = payments?.reduce((sum: number, p: any) => sum + p.amount, 0) ?? 0;
  const remaining = consultant.contractAmount - totalPaid;
  const pctPaid = consultant.contractAmount > 0 ? (totalPaid / consultant.contractAmount) * 100 : 0;

  return (
    <div className="border-t border-border/50 bg-muted/20 p-3 space-y-3">
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-[10px] text-muted-foreground uppercase">Contract</p>
          <p className="text-xs font-semibold">${(consultant.contractAmount / 100).toLocaleString()}</p>
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground uppercase">Paid</p>
          <p className="text-xs font-semibold text-emerald-600">${(totalPaid / 100).toLocaleString()}</p>
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground uppercase">Remaining</p>
          <p className={`text-xs font-semibold ${remaining > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>${(remaining / 100).toLocaleString()}</p>
        </div>
      </div>
      <Progress value={Math.min(pctPaid, 100)} className="h-1.5" />
      {consultant.notes && <p className="text-[11px] text-muted-foreground italic">{consultant.notes}</p>}

      {/* Payments list */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Payments</span>
          {isAdmin && (
            <Dialog open={paymentDialogOpen === consultant.id} onOpenChange={(open: boolean) => setPaymentDialogOpen(open ? consultant.id : null)}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="h-6 text-[10px]"><Plus className="h-2.5 w-2.5 mr-0.5" /> Payment</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Record Payment — {consultant.name}</DialogTitle></DialogHeader>
                <form onSubmit={(e: React.FormEvent<HTMLFormElement>) => { e.preventDefault(); const fd = new FormData(e.currentTarget); createPayment.mutate({ consultantId: consultant.id, amount: Math.round(Number(fd.get("amount")) * 100), paymentDate: fd.get("paymentDate") ? new Date(fd.get("paymentDate") as string) : undefined, notes: (fd.get("notes") as string) || undefined }); }} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2"><Label>Amount ($)</Label><Input name="amount" type="number" min={0} step={0.01} required placeholder="0.00" /></div>
                    <div className="space-y-2"><Label>Date</Label><Input name="paymentDate" type="date" defaultValue={new Date().toISOString().split('T')[0]} /></div>
                  </div>
                  <div className="space-y-2"><Label>Notes</Label><Input name="notes" placeholder="e.g., 50% milestone payment" /></div>
                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setPaymentDialogOpen(null)}>Cancel</Button>
                    <Button type="submit" disabled={createPayment.isPending}>{createPayment.isPending ? "Recording..." : "Record Payment"}</Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          )}
        </div>
        {isLoading ? (
          <p className="text-[10px] text-muted-foreground text-center py-1">Loading...</p>
        ) : !payments || payments.length === 0 ? (
          <p className="text-[10px] text-muted-foreground text-center py-1">No payments recorded</p>
        ) : (
          payments.map((p: any) => (
            <div key={p.id} className="flex items-center gap-2 p-2 rounded bg-background group">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium">${(p.amount / 100).toLocaleString()}</span>
                  <span className="text-[10px] text-muted-foreground">{new Date(p.paymentDate).toLocaleDateString()}</span>
                </div>
                {p.notes && <p className="text-[10px] text-muted-foreground truncate">{p.notes}</p>}
              </div>
              {isAdmin && (
                <Button variant="ghost" size="icon" className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => deletePayment.mutate({ id: p.id })}>
                  <Trash2 className="h-2.5 w-2.5 text-muted-foreground" />
                </Button>
              )}
            </div>
          ))
        )}
      </div>

      {/* Admin actions */}
      {isAdmin && (
        <div className="flex items-center gap-2 pt-1 border-t border-border/30">
          <select
            className="flex-1 h-7 rounded border border-input bg-background px-2 text-[10px]"
            value={consultant.status}
            onChange={(e) => updateConsultant.mutate({ id: consultant.id, status: e.target.value as any })}
          >
            <option value="active">Active</option>
            <option value="pending">Pending</option>
            <option value="completed">Completed</option>
            <option value="terminated">Terminated</option>
          </select>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 text-[10px] text-red-500 hover:text-red-600 hover:bg-red-50">
                <Trash2 className="h-3 w-3 mr-1" /> Remove
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove Consultant</AlertDialogTitle>
                <AlertDialogDescription>
                  Remove "{consultant.name}" and all their payment records from this project? This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => deleteConsultant.mutate({ id: consultant.id })} className="bg-red-500 hover:bg-red-600">Remove</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}
    </div>
  );
}
