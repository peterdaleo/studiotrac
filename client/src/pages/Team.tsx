import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useEffectiveAdmin } from "@/contexts/StaffPreviewContext";
import { useSubscription } from "@/hooks/useSubscription";
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
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  Plus,
  Users,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ArrowLeft,
  Shield,
  UserPlus,
  Mail,
  Trash2,
  KeyRound,
  Archive,
  ChevronRight,
  ChevronDown,
  Pencil,
  Check,
  X,
  LayoutGrid,
  List,
} from "lucide-react";
import { useLocation, useParams } from "wouter";
import { getPhaseShortLabel } from "@shared/constants";
import { toast } from "sonner";
import { isDeadlineOverdueUTC } from "@/lib/utils";
import {
  Tooltip as UITooltip,
  TooltipContent as UITooltipContent,
  TooltipTrigger as UITooltipTrigger,
} from "@/components/ui/tooltip";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

// Custom tooltip with guaranteed contrast
function WorkloadTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-popover text-popover-foreground border border-border rounded-lg shadow-lg p-3 text-xs">
      <p className="font-semibold mb-1">{label}</p>
      {payload.map((entry: any, i: number) => (
        <div key={i} className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: entry.fill || entry.color }} />
          <span className="text-muted-foreground">{entry.name}:</span>
          <span className="font-medium">{entry.value}</span>
        </div>
      ))}
    </div>
  );
}

const statusDotMap: Record<string, string> = {
  on_track: "bg-emerald-500",
  on_hold: "bg-amber-500",
  delayed: "bg-red-500",
  completed: "bg-slate-400",
};

function getRoleLabel(role?: string | null) {
  if (role === "admin") return "Admin";
  if (role === "pm") return "PM";
  return "Staff";
}

function getRoleBadgeVariant(role?: string | null): "default" | "secondary" | "outline" {
  if (role === "admin") return "default";
  if (role === "pm") return "secondary";
  return "outline";
}

export default function Team() {
  const params = useParams<{ id?: string }>();
  const selectedMemberId = params.id ? Number(params.id) : null;
  const [, setLocation] = useLocation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [inviteRole, setInviteRole] = useState<"user" | "pm" | "admin">("user");
  const [resetPasswordDialogUserId, setResetPasswordDialogUserId] = useState<number | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState("");
  const [resetPasswordConfirm, setResetPasswordConfirm] = useState("");
  const [resetPasswordError, setResetPasswordError] = useState("");
  const [archivedTasksExpanded, setArchivedTasksExpanded] = useState(false);
  const [archivedProjectsExpanded, setArchivedProjectsExpanded] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [userRolesExpanded, setUserRolesExpanded] = useState(false);
  const [teamView, setTeamView] = useState<"grid" | "list">("grid");

  const { user } = useAuth();
  const isAdmin = useEffectiveAdmin(user?.role);
  const { maxTeamMembers } = useSubscription();

  const { data: teamMembers, isLoading } = trpc.teamMembers.list.useQuery();
  const { data: allTasks } = trpc.tasks.list.useQuery({});
  const { data: projects } = trpc.projects.list.useQuery({});
  const { data: registeredUsers } = trpc.teamMembers.listUsers.useQuery(undefined, { enabled: isAdmin });
  const { data: allActiveTimers } = trpc.timeEntries.allActiveTimers.useQuery();
  const utils = trpc.useUtils();

  const activeUserIds = useMemo(
    () => new Set((allActiveTimers ?? []).map((t) => t.userId).filter((id): id is number => id != null)),
    [allActiveTimers]
  );

  const atMemberLimit = (teamMembers?.length ?? 0) >= maxTeamMembers;

  const createMember = trpc.teamMembers.create.useMutation({
    onSuccess: () => {
      utils.teamMembers.list.invalidate();
      utils.dashboard.stats.invalidate();
      setDialogOpen(false);
      toast.success("Team member added");
    },
    onError: (err) => {
      if (err.message.includes("Upgrade")) toast.error(err.message);
    },
  });

  const updateRole = trpc.teamMembers.updateRole.useMutation({
    onSuccess: () => {
      utils.teamMembers.listUsers.invalidate();
      toast.success("Role updated successfully");
    },
    onError: (err) => {
      toast.error(err.message || "Failed to update role");
    },
  });

  const inviteMember = trpc.teamMembers.invite.useMutation({
    onSuccess: (data) => {
      utils.teamMembers.list.invalidate();
      utils.dashboard.stats.invalidate();
      setInviteDialogOpen(false);
      if (data.emailSent) {
        toast.success("Team member invited and email sent successfully");
      } else {
        toast.success("Team member invited, but the email was not sent. Add RESEND_API_KEY in Railway to enable delivery.");
      }
    },
    onError: (err) => {
      toast.error(err.message || "Failed to invite team member");
    },
  });

  const resetPassword = trpc.teamMembers.resetPassword.useMutation({
    onSuccess: () => {
      setResetPasswordDialogUserId(null);
      setResetPasswordValue("");
      setResetPasswordConfirm("");
      setResetPasswordError("");
      toast.success("Password reset successfully. Let the team member know their new password.");
    },
    onError: (err) => {
      setResetPasswordError(err.message || "Failed to reset password");
    },
  });

  const deleteMember = trpc.teamMembers.delete.useMutation({
    onSuccess: () => {
      utils.teamMembers.list.invalidate();
      utils.dashboard.stats.invalidate();
      setLocation("/team");
      toast.success("Team member removed");
    },
    onError: (err) => {
      toast.error(err.message || "Failed to remove team member");
    },
  });

  const removeUser = trpc.teamMembers.removeUser.useMutation({
    onSuccess: () => {
      utils.teamMembers.listUsers.invalidate();
      toast.success("User removed from organization");
    },
    onError: (err) => {
      toast.error(err.message || "Failed to remove user");
    },
  });

  const updateMember = trpc.teamMembers.update.useMutation({
    onSuccess: () => {
      utils.teamMembers.list.invalidate();
      setEditingTitle(false);
      toast.success("Role updated");
    },
    onError: (err) => toast.error(err.message || "Failed to update role"),
  });

  const memberStats = useMemo(() => {
    if (!teamMembers || !allTasks) return [];
    return teamMembers.map((m) => {
      const memberTasks = allTasks.filter((t) => t.assigneeId === m.id);
      const completed = memberTasks.filter((t) => t.status === "done").length;
      const now = new Date();
      const overdue = memberTasks.filter((t) => t.status !== "done" && t.deadline != null && isDeadlineOverdueUTC(t.deadline)).length;
      const inProgress = memberTasks.filter((t) => t.status === "in_progress").length;
      const total = memberTasks.length;
      const missedRate = total > 0 ? Math.round((overdue / total) * 100) : 0;
      const activeProjectIds = new Set(memberTasks.filter((t) => t.status !== "done").map((t) => t.projectId));
      // Also count projects where this member is the assigned Project Manager
      if (projects) {
        projects.filter((p) => p.projectManagerId === m.id && p.status !== "completed").forEach((p) => activeProjectIds.add(p.id));
      }
      // Find matching registered user by email or userId
      const matchedUser = registeredUsers?.find(
        (u) => (m.userId && u.id === m.userId) || (m.email && u.email === m.email)
      );
      return {
        ...m,
        totalTasks: total,
        completed,
        overdue,
        inProgress,
        missedRate,
        activeProjects: activeProjectIds.size,
        registeredUser: matchedUser ?? null,
      };
    });
  }, [teamMembers, allTasks, registeredUsers, projects]);

  const selectedMember = selectedMemberId ? memberStats.find((m) => m.id === selectedMemberId) : null;
  const selectedMemberTasks = useMemo(() => {
    if (!selectedMemberId || !allTasks) return [];
    return allTasks.filter((t) => t.assigneeId === selectedMemberId);
  }, [selectedMemberId, allTasks]);

  const activeMemberTasks = useMemo(
    () => selectedMemberTasks.filter((t) => t.status !== "done"),
    [selectedMemberTasks]
  );
  const archivedMemberTasks = useMemo(
    () => selectedMemberTasks.filter((t) => t.status === "done"),
    [selectedMemberTasks]
  );

  const selectedMemberProjects = useMemo(() => {
    if (!selectedMemberId || !allTasks || !projects) return [];
    // Include projects where the member has an assigned task
    const projectIds = new Set(allTasks.filter((t) => t.assigneeId === selectedMemberId).map((t) => t.projectId));
    // Also include projects where the member is the assigned Project Manager
    return projects.filter((p) => projectIds.has(p.id) || p.projectManagerId === selectedMemberId);
  }, [selectedMemberId, allTasks, projects]);

  const workloadChartData = useMemo(() => {
    // Use first name + last initial to disambiguate members with the same first name
    const firstNames = memberStats.map(m => m.name.split(" ")[0]);
    return memberStats.map((m) => {
      const firstName = m.name.split(" ")[0];
      const isDuplicate = firstNames.filter(n => n === firstName).length > 1;
      const displayName = isDuplicate && m.name.split(" ").length > 1
        ? `${firstName} ${m.name.split(" ")[1][0]}.`
        : firstName;
      return {
        name: displayName,
        tasks: m.totalTasks,
        completed: m.completed,
        overdue: m.overdue,
      };
    });
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

  const handleInvite = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = fd.get("inviteName") as string;
    const email = fd.get("inviteEmail") as string;
    const title = (fd.get("inviteTitle") as string) || undefined;
    inviteMember.mutate({
      name,
      email,
      title,
      role: inviteRole,
      origin: window.location.origin,
    });
  };

  const handleRoleChange = (userId: number, newRole: "user" | "pm" | "admin") => {
    updateRole.mutate({ userId, role: newRole });
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
      <>
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
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">{selectedMember.name}</h1>
              {selectedMember.registeredUser && (
                <Badge variant={getRoleBadgeVariant(selectedMember.registeredUser.role)} className="text-[10px]">
                  {getRoleLabel(selectedMember.registeredUser.role)}
                </Badge>
              )}
            </div>
            {isAdmin && editingTitle ? (
              <div className="flex items-center gap-1.5 mt-0.5">
                <Input
                  className="h-7 text-sm w-64"
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  placeholder="e.g. Designer, PM, Production"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") updateMember.mutate({ id: selectedMember.id, title: titleDraft.trim() || null });
                    if (e.key === "Escape") setEditingTitle(false);
                  }}
                  autoFocus
                />
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-emerald-600 hover:text-emerald-700"
                  disabled={updateMember.isPending}
                  onClick={() => updateMember.mutate({ id: selectedMember.id, title: titleDraft.trim() || null })}
                >
                  <Check className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-muted-foreground"
                  onClick={() => setEditingTitle(false)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 group/title mt-0.5">
                <p className="text-sm text-muted-foreground">{selectedMember.title || "No title set"}</p>
                {isAdmin && (
                  <button
                    className="opacity-0 group-hover/title:opacity-100 transition-opacity"
                    onClick={() => { setTitleDraft(selectedMember.title ?? ""); setEditingTitle(true); }}
                    title="Edit role/title"
                  >
                    <Pencil className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                  </button>
                )}
              </div>
            )}
          </div>
          {isAdmin && (
            <div className="ml-auto flex items-center gap-2">
              {selectedMember.registeredUser && selectedMember.registeredUser.id !== user?.id && (
                <Select
                  value={selectedMember.registeredUser.role}
                  onValueChange={(val) => handleRoleChange(selectedMember.registeredUser!.id, val as "user" | "pm" | "admin")}
                >
                  <SelectTrigger className="w-[130px]" size="sm">
                    <Shield className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="pm">Project Manager</SelectItem>
                    <SelectItem value="user">Staff</SelectItem>
                  </SelectContent>
                </Select>
              )}
              {selectedMember.registeredUser && selectedMember.registeredUser.loginMethod === "email" && selectedMember.registeredUser.id !== user?.id && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => {
                    setResetPasswordValue("");
                    setResetPasswordConfirm("");
                    setResetPasswordError("");
                    setResetPasswordDialogUserId(selectedMember.registeredUser!.id);
                  }}
                >
                  <KeyRound className="h-3.5 w-3.5" /> Reset Password
                </Button>
              )}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" className="text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700 gap-1.5">
                    <Trash2 className="h-3.5 w-3.5" /> Remove
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Remove Team Member</AlertDialogTitle>
                    <AlertDialogDescription>
                      Are you sure you want to remove <strong>{selectedMember.name}</strong> from the team? This will deactivate their profile. Their existing task assignments and time entries will be preserved.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-red-600 hover:bg-red-700"
                      onClick={() => deleteMember.mutate({ id: selectedMember.id })}
                    >
                      Remove Member
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}
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
          {(() => {
            const activeProjects = selectedMemberProjects.filter((p) => p.status !== "completed");
            const completedProjects = selectedMemberProjects.filter((p) => p.status === "completed");
            return (
              <Card className="border-0 shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold">Assigned Projects ({activeProjects.length})</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {selectedMemberProjects.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">No projects assigned</p>
                  ) : (
                    <>
                      <div className="divide-y">
                        {activeProjects.map((p) => (
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
                        {activeProjects.length === 0 && (
                          <p className="text-sm text-muted-foreground text-center py-6">No active projects</p>
                        )}
                      </div>

                      {/* Archived (completed) projects */}
                      {completedProjects.length > 0 && (
                        <div className="border-t">
                          <button
                            className="flex items-center gap-2 w-full px-5 py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                            onClick={() => setArchivedProjectsExpanded((v) => !v)}
                          >
                            {archivedProjectsExpanded
                              ? <ChevronDown className="h-3.5 w-3.5" />
                              : <ChevronRight className="h-3.5 w-3.5" />}
                            <Archive className="h-3.5 w-3.5" />
                            Archived ({completedProjects.length})
                          </button>
                          {archivedProjectsExpanded && (
                            <div className="divide-y opacity-70">
                              {completedProjects.map((p) => (
                                <button
                                  key={p.id}
                                  onClick={() => setLocation(`/projects/${p.id}`)}
                                  className="w-full flex items-center gap-3 px-5 py-3 hover:bg-muted/30 transition-colors text-left"
                                >
                                  <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium truncate line-through text-muted-foreground">{p.name}</p>
                                    <p className="text-xs text-muted-foreground">{getPhaseShortLabel(p.phase)} - {p.completionPercentage}%</p>
                                  </div>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            );
          })()}

          {/* Tasks */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">Tasks ({activeMemberTasks.length})</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {activeMemberTasks.length === 0 && archivedMemberTasks.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No tasks assigned</p>
              ) : (
                <>
                  <div className="divide-y">
                    {activeMemberTasks.map((t) => {
                      const isOverdue = t.deadline && isDeadlineOverdueUTC(t.deadline) && t.status !== "done";
                      return (
                        <div key={t.id} className="flex items-center gap-3 px-5 py-3 cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => setLocation(`/projects/${t.projectId}`)}>
                          {isOverdue ? (
                            <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />
                          ) : (
                            <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm truncate">{t.title}</p>
                            <p className="text-xs text-muted-foreground">
                              {projects?.find((p) => p.id === t.projectId)?.name ?? ""}
                            </p>
                          </div>
                          <Badge variant="outline" className="text-[10px]">P{t.priority}</Badge>
                        </div>
                      );
                    })}
                  </div>

                  {/* Archived (done) tasks */}
                  {archivedMemberTasks.length > 0 && (
                    <div className="border-t">
                      <button
                        className="flex items-center gap-2 w-full px-5 py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                        onClick={() => setArchivedTasksExpanded((v) => !v)}
                      >
                        {archivedTasksExpanded
                          ? <ChevronDown className="h-3.5 w-3.5" />
                          : <ChevronRight className="h-3.5 w-3.5" />}
                        <Archive className="h-3.5 w-3.5" />
                        Archived ({archivedMemberTasks.length})
                      </button>
                      {archivedTasksExpanded && (
                        <div className="divide-y opacity-70">
                          {archivedMemberTasks.map((t) => (
                            <div key={t.id} className="flex items-center gap-3 px-5 py-3 cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => setLocation(`/projects/${t.projectId}`)}>  
                              <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm truncate line-through text-muted-foreground">{t.title}</p>
                                <p className="text-xs text-muted-foreground">
                                  {projects?.find((p) => p.id === t.projectId)?.name ?? ""}
                                </p>
                              </div>
                              <Badge variant="outline" className="text-[10px]">P{t.priority}</Badge>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Reset Password Modal */}
      <Dialog
        open={resetPasswordDialogUserId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setResetPasswordDialogUserId(null);
            setResetPasswordValue("");
            setResetPasswordConfirm("");
            setResetPasswordError("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
            <DialogDescription>
              Set a new temporary password for <strong>{selectedMember?.name}</strong>. After resetting, let them know their new password so they can log in.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="reset-pw-new">New Password</Label>
              <Input
                id="reset-pw-new"
                type="password"
                placeholder="At least 6 characters"
                minLength={6}
                value={resetPasswordValue}
                onChange={(e) => { setResetPasswordValue(e.target.value); setResetPasswordError(""); }}
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reset-pw-confirm">Confirm Password</Label>
              <Input
                id="reset-pw-confirm"
                type="password"
                placeholder="Repeat the new password"
                value={resetPasswordConfirm}
                onChange={(e) => { setResetPasswordConfirm(e.target.value); setResetPasswordError(""); }}
                autoComplete="new-password"
              />
            </div>
            {resetPasswordError && (
              <p className="text-sm text-red-600">{resetPasswordError}</p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setResetPasswordDialogUserId(null);
                setResetPasswordValue("");
                setResetPasswordConfirm("");
                setResetPasswordError("");
              }}
            >
              Cancel
            </Button>
            <Button
              disabled={resetPassword.isPending}
              onClick={() => {
                if (resetPasswordValue.length < 6) {
                  setResetPasswordError("Password must be at least 6 characters");
                  return;
                }
                if (resetPasswordValue !== resetPasswordConfirm) {
                  setResetPasswordError("Passwords do not match");
                  return;
                }
                if (resetPasswordDialogUserId !== null) {
                  resetPassword.mutate({ userId: resetPasswordDialogUserId, newPassword: resetPasswordValue });
                }
              }}
            >
              {resetPassword.isPending ? "Resetting..." : "Reset Password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </>
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
        <div className="flex gap-2">
          {isAdmin && (
            <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" className="gap-2" disabled={atMemberLimit} title={atMemberLimit ? `Your plan allows up to ${maxTeamMembers} team members` : undefined}>
                  <UserPlus className="h-4 w-4" /> Invite to App
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Invite Team Member</DialogTitle>
                  <DialogDescription>
                    Send an invitation to join your studio workspace. They will appear in the team list and can be assigned to projects.
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleInvite} className="space-y-4">
                  <div className="space-y-2">
                    <Label>Name</Label>
                    <Input name="inviteName" placeholder="Full name" required />
                  </div>
                  <div className="space-y-2">
                    <Label>Email</Label>
                    <Input name="inviteEmail" type="email" placeholder="email@studio.com" required />
                  </div>
                  <div className="space-y-2">
                    <Label>Title</Label>
                    <Input name="inviteTitle" placeholder="e.g., Senior Architect" />
                  </div>
                  <div className="space-y-2">
                    <Label>Role</Label>
                    <Select value={inviteRole} onValueChange={(val) => setInviteRole(val as "user" | "pm" | "admin")}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select role" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="user">Staff</SelectItem>
                        <SelectItem value="pm">Project Manager</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setInviteDialogOpen(false)}>Cancel</Button>
                    <Button type="submit" disabled={inviteMember.isPending} className="gap-2">
                      <Mail className="h-4 w-4" />
                      {inviteMember.isPending ? "Inviting..." : "Send Invite"}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          )}
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button disabled={atMemberLimit} title={atMemberLimit ? `Your plan allows up to ${maxTeamMembers} team members` : undefined}>
                <Plus className="h-4 w-4 mr-2" /> Add to Roster
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Team Member</DialogTitle>
                <DialogDescription>
                  Add a new member to your studio team.
                </DialogDescription>
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
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                  <Button type="submit" disabled={createMember.isPending}>
                    {createMember.isPending ? "Adding..." : "Add Member"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* User Roles (Admin Only) */}
      {isAdmin && (
        <Card className="border-0 shadow-sm">
          <button
            className="w-full flex items-center justify-between px-6 py-4 hover:bg-muted/30 transition-colors rounded-t-xl"
            onClick={() => setUserRolesExpanded((v) => !v)}
          >
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-muted-foreground" />
              <span className="text-base font-semibold">User Roles</span>
              <Badge variant="secondary" className="text-[10px] ml-1">
                {(registeredUsers?.length ?? 0) + (memberStats?.filter(m => !registeredUsers?.some(u => (m.userId && u.id === m.userId) || (m.email && u.email === m.email))).length ?? 0)}
              </Badge>
            </div>
            {userRolesExpanded
              ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
              : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          </button>
          {userRolesExpanded && (
            <CardContent className="pt-0 space-y-4">
              {/* ── Registered Users ── */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 px-1">
                  Registered Users
                </p>
                {!registeredUsers || registeredUsers.length === 0 ? (
                  <p className="text-xs text-muted-foreground px-1 py-2">No registered users yet.</p>
                ) : (
                  <div className="divide-y rounded-lg border">
                    {registeredUsers.map((ru) => {
                      const isCurrentUser = ru.id === user?.id;
                      return (
                        <div key={ru.id} className="flex items-center gap-3 px-3 py-2.5 first:rounded-t-lg last:rounded-b-lg">
                          <Avatar className="h-8 w-8 shrink-0">
                            <AvatarFallback
                              className="text-xs font-semibold"
                              style={{ backgroundColor: "#6366f120", color: "#6366f1" }}
                            >
                              {(ru.name ?? ru.email ?? "?").charAt(0).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="text-sm font-medium truncate">{ru.name ?? "Unnamed"}</p>
                              {isCurrentUser && (
                                <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 shrink-0">You</Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground truncate">{ru.email ?? "No email"}</p>
                          </div>
                          <Badge className="text-[9px] px-1.5 py-0 h-4 shrink-0 bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-100">
                            Registered
                          </Badge>
                          <div className="flex items-center gap-1.5">
                            {!isCurrentUser && (
                              <>
                                {ru.loginMethod === "email" && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 px-2 text-muted-foreground hover:text-foreground gap-1"
                                    title="Reset password"
                                    onClick={() => {
                                      setResetPasswordValue("");
                                      setResetPasswordConfirm("");
                                      setResetPasswordError("");
                                      setResetPasswordDialogUserId(ru.id);
                                    }}
                                  >
                                    <KeyRound className="h-3 w-3" />
                                  </Button>
                                )}
                                <Select
                                  value={ru.role}
                                  onValueChange={(val) => handleRoleChange(ru.id, val as "user" | "pm" | "admin")}
                                >
                                  <SelectTrigger className="w-[130px] h-7 text-xs">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="admin">Admin</SelectItem>
                                    <SelectItem value="pm">Project Manager</SelectItem>
                                    <SelectItem value="user">Staff</SelectItem>
                                  </SelectContent>
                                </Select>
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-red-600">
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Remove User</AlertDialogTitle>
                                      <AlertDialogDescription>
                                        Are you sure you want to remove <strong>{ru.name}</strong> from the organization? They will lose access to all projects and data.
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                                      <AlertDialogAction
                                        className="bg-red-600 hover:bg-red-700"
                                        onClick={() => removeUser.mutate({ userId: ru.id })}
                                      >
                                        Remove User
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              {/* ── Roster-Only Members ── */}
              {(() => {
                const rosterOnly = (memberStats ?? []).filter(
                  (m) => !registeredUsers?.some(
                    (u) => (m.userId && u.id === m.userId) || (m.email && u.email === m.email)
                  )
                );
                if (rosterOnly.length === 0) return null;
                return (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 px-1">
                      Roster Members (No App Account)
                    </p>
                    <div className="divide-y rounded-lg border">
                      {rosterOnly.map((m) => (
                        <div key={m.id} className="flex items-center gap-3 px-3 py-2.5 first:rounded-t-lg last:rounded-b-lg">
                          <Avatar className="h-8 w-8 shrink-0">
                            <AvatarFallback
                              className="text-xs font-semibold"
                              style={{
                                backgroundColor: (m.avatarColor ?? "#6366f1") + "20",
                                color: m.avatarColor ?? "#6366f1",
                              }}
                            >
                              {(m.name ?? m.email ?? "?").charAt(0).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{m.name ?? "Unnamed"}</p>
                            <p className="text-xs text-muted-foreground truncate">{m.email ?? "No email"}</p>
                          </div>
                          <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 shrink-0 text-amber-600 border-amber-200 bg-amber-50">
                            Roster Only
                          </Badge>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-red-600">
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Remove from Roster</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Are you sure you want to remove <strong>{m.name}</strong> from the team roster?
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  className="bg-red-600 hover:bg-red-700"
                                  onClick={() => deleteMember.mutate({ id: m.id })}
                                >
                                  Remove
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </CardContent>
          )}
        </Card>
      )}
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
                  <Tooltip content={<WorkloadTooltip />} cursor={{ fill: 'hsl(var(--muted))' }} />
                  <Bar dataKey="completed" fill="#10b981" radius={[4, 4, 0, 0]} name="Completed" stackId="a" />
                  <Bar dataKey="overdue" fill="#ef4444" radius={[4, 4, 0, 0]} name="Overdue" stackId="a" />
                  <Bar dataKey="tasks" fill="oklch(0.55 0.15 230)" radius={[4, 4, 0, 0]} name="Total" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Team Grid / List */}
      {memberStats.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20">
          <Users className="h-12 w-12 text-muted-foreground/30 mb-4" />
          <h3 className="text-lg font-medium">No team members yet</h3>
          <p className="text-sm text-muted-foreground mt-1">Add your first team member to get started</p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* View toggle */}
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">{memberStats.length} member{memberStats.length !== 1 ? "s" : ""}</p>
            <div className="flex items-center gap-0.5 border rounded-md p-0.5 bg-muted/40">
              <Button
                variant={teamView === "grid" ? "secondary" : "ghost"}
                size="icon"
                className="h-7 w-7"
                title="Grid view"
                onClick={() => setTeamView("grid")}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant={teamView === "list" ? "secondary" : "ghost"}
                size="icon"
                className="h-7 w-7"
                title="List view"
                onClick={() => setTeamView("list")}
              >
                <List className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {/* Grid view */}
          {teamView === "grid" && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {memberStats.map((member) => (
                <Card
                  key={member.id}
                  className="border-0 shadow-sm hover:shadow-md transition-all cursor-pointer group"
                  onClick={() => setLocation(`/team/${member.id}`)}
                >
                  <CardContent className="p-5">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="relative shrink-0">
                        <Avatar className="h-10 w-10 border-2" style={{ borderColor: member.avatarColor ?? "#6366f1" }}>
                          <AvatarFallback className="font-semibold" style={{ backgroundColor: (member.avatarColor ?? "#6366f1") + "20", color: member.avatarColor ?? "#6366f1" }}>
                            {member.name.charAt(0)}
                          </AvatarFallback>
                        </Avatar>
                        {member.userId != null && activeUserIds.has(member.userId) && (
                          <UITooltip>
                            <UITooltipTrigger asChild>
                              <span className="absolute -top-0.5 -right-0.5 flex h-3 w-3">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
                              </span>
                            </UITooltipTrigger>
                            <UITooltipContent side="top">Currently tracking time</UITooltipContent>
                          </UITooltip>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="font-semibold text-sm group-hover:text-primary transition-colors truncate">{member.name}</p>
                          {member.registeredUser && (
                            <Badge variant={getRoleBadgeVariant(member.registeredUser.role)} className="text-[9px] px-1.5 py-0 h-4 shrink-0">
                              {getRoleLabel(member.registeredUser.role)}
                            </Badge>
                          )}
                        </div>
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

          {/* List view */}
          {teamView === "list" && (
            <Card className="border-0 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40">
                      <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground">Member</th>
                      <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground">Role</th>
                      <th className="text-center px-4 py-2.5 font-medium text-xs text-muted-foreground">Tasks</th>
                      <th className="text-center px-4 py-2.5 font-medium text-xs text-muted-foreground">Projects</th>
                      <th className="text-center px-4 py-2.5 font-medium text-xs text-muted-foreground">Missed %</th>
                      <th className="text-center px-4 py-2.5 font-medium text-xs text-muted-foreground">Completion %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {memberStats.map((member) => {
                      const completionPct = member.totalTasks > 0 ? Math.round((member.completed / member.totalTasks) * 100) : 0;
                      return (
                        <tr
                          key={member.id}
                          className="hover:bg-muted/30 transition-colors cursor-pointer group"
                          onClick={() => setLocation(`/team/${member.id}`)}
                        >
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2.5">
                              <div className="relative shrink-0">
                                <Avatar className="h-7 w-7">
                                  <AvatarFallback
                                    className="text-xs font-semibold"
                                    style={{ backgroundColor: (member.avatarColor ?? "#6366f1") + "20", color: member.avatarColor ?? "#6366f1" }}
                                  >
                                    {member.name.charAt(0)}
                                  </AvatarFallback>
                                </Avatar>
                                {member.userId != null && activeUserIds.has(member.userId) && (
                                  <UITooltip>
                                    <UITooltipTrigger asChild>
                                      <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                                      </span>
                                    </UITooltipTrigger>
                                    <UITooltipContent side="top">Currently tracking time</UITooltipContent>
                                  </UITooltip>
                                )}
                              </div>
                              <span className="font-medium group-hover:text-primary transition-colors truncate max-w-[160px]">{member.name}</span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex flex-col gap-0.5">
                              <span className="text-xs text-muted-foreground truncate max-w-[120px]">{member.title ?? "Team Member"}</span>
                              {member.registeredUser && (
                                <Badge variant={getRoleBadgeVariant(member.registeredUser.role)} className="text-[9px] px-1.5 py-0 h-4 w-fit">
                                  {getRoleLabel(member.registeredUser.role)}
                                </Badge>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-center font-semibold">{member.totalTasks}</td>
                          <td className="px-4 py-2.5 text-center font-semibold text-emerald-600">{member.activeProjects}</td>
                          <td className="px-4 py-2.5 text-center">
                            <span className={`font-semibold ${
                              member.missedRate > 20 ? "text-red-600" : member.missedRate > 10 ? "text-amber-600" : "text-emerald-600"
                            }`}>{member.missedRate}%</span>
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2 justify-center">
                              <Progress value={completionPct} className="h-1.5 w-16" />
                              <span className="text-xs font-medium w-8 text-right">{completionPct}%</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Reset Password Modal (overview page) */}
      <Dialog
        open={resetPasswordDialogUserId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setResetPasswordDialogUserId(null);
            setResetPasswordValue("");
            setResetPasswordConfirm("");
            setResetPasswordError("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
            <DialogDescription>
              Set a new temporary password for{" "}
              <strong>
                {registeredUsers?.find((u) => u.id === resetPasswordDialogUserId)?.name ?? "this user"}
              </strong>.
              After resetting, let them know their new password so they can log in.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="reset-pw-new-ov">New Password</Label>
              <Input
                id="reset-pw-new-ov"
                type="password"
                placeholder="At least 6 characters"
                minLength={6}
                value={resetPasswordValue}
                onChange={(e) => { setResetPasswordValue(e.target.value); setResetPasswordError(""); }}
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reset-pw-confirm-ov">Confirm Password</Label>
              <Input
                id="reset-pw-confirm-ov"
                type="password"
                placeholder="Repeat the new password"
                value={resetPasswordConfirm}
                onChange={(e) => { setResetPasswordConfirm(e.target.value); setResetPasswordError(""); }}
                autoComplete="new-password"
              />
            </div>
            {resetPasswordError && (
              <p className="text-sm text-red-600">{resetPasswordError}</p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setResetPasswordDialogUserId(null);
                setResetPasswordValue("");
                setResetPasswordConfirm("");
                setResetPasswordError("");
              }}
            >
              Cancel
            </Button>
            <Button
              disabled={resetPassword.isPending}
              onClick={() => {
                if (resetPasswordValue.length < 6) {
                  setResetPasswordError("Password must be at least 6 characters");
                  return;
                }
                if (resetPasswordValue !== resetPasswordConfirm) {
                  setResetPasswordError("Passwords do not match");
                  return;
                }
                if (resetPasswordDialogUserId !== null) {
                  resetPassword.mutate({ userId: resetPasswordDialogUserId, newPassword: resetPasswordValue });
                }
              }}
            >
              {resetPassword.isPending ? "Resetting..." : "Reset Password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
