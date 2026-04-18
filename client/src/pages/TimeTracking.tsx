import { useState, useEffect, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useEffectiveAdmin } from "@/contexts/StaffPreviewContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Play, Square, Clock, Plus, Calendar, ChevronLeft, ChevronRight, Timer, Trash2, Edit2, Check, X, Pencil, Download, Users, FileSpreadsheet } from "lucide-react";
import { PROJECT_PHASES, type ProjectPhase } from "@shared/constants";
import { toast } from "sonner";

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatTime(date: Date): string {
  return new Date(date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1)); // Monday start
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function toTimeString(date: Date): string {
  const d = new Date(date);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function toDateString(date: Date): string {
  return new Date(date).toISOString().split("T")[0];
}

export default function TimeTracking() {
  const { user } = useAuth();
  const isAdmin = useEffectiveAdmin(user?.role);

  const [activeTab, setActiveTab] = useState("timer");
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedMember, setSelectedMember] = useState<number | null>(null);

  // Timer state
  const [timerElapsed, setTimerElapsed] = useState(0);
  const [timerProjectId, setTimerProjectId] = useState<string>("");
  const [timerDescription, setTimerDescription] = useState("");
  const [timerBillable, setTimerBillable] = useState(true);
  const [timerPhase, setTimerPhase] = useState<ProjectPhase | "">("");

  // Manual entry state
  const [manualOpen, setManualOpen] = useState(false);
  const [manualProjectId, setManualProjectId] = useState<string>("");
  const [manualDescription, setManualDescription] = useState("");
  const [manualDate, setManualDate] = useState(new Date().toISOString().split("T")[0]);
  const [manualStartTime, setManualStartTime] = useState("09:00");
  const [manualEndTime, setManualEndTime] = useState("10:00");
  const [manualBillable, setManualBillable] = useState(true);
  const [manualPhase, setManualPhase] = useState<ProjectPhase | "">("");

  // Team report date range (admin)
  const [reportStartDate, setReportStartDate] = useState<string>("");
  const [reportEndDate, setReportEndDate] = useState<string>("");

  // Edit entry state
  const [editingEntryId, setEditingEntryId] = useState<number | null>(null);
  const [editData, setEditData] = useState<{
    projectId: string;
    description: string;
    date: string;
    startTime: string;
    endTime: string;
    billable: boolean;
  }>({ projectId: "", description: "", date: "", startTime: "", endTime: "", billable: true });

  const projects = trpc.projects.list.useQuery();
  const teamMembers = trpc.teamMembers.list.useQuery();
  const activeTimer = trpc.timeEntries.activeTimer.useQuery(undefined, { refetchInterval: 1000 });

  // Admin team time report query
  const teamTimeReportInput = useMemo(() => {
    const input: { startDate?: Date; endDate?: Date } = {};
    if (reportStartDate) input.startDate = new Date(reportStartDate + "T00:00:00");
    if (reportEndDate) input.endDate = new Date(reportEndDate + "T23:59:59");
    return Object.keys(input).length > 0 ? input : undefined;
  }, [reportStartDate, reportEndDate]);
  const teamTimeReport = trpc.timeAnalytics.teamTimeReport.useQuery(teamTimeReportInput, { enabled: user?.role === "admin" });

  const weekStart = useMemo(() => {
    const ws = getWeekStart(new Date());
    ws.setDate(ws.getDate() + weekOffset * 7);
    return ws;
  }, [weekOffset]);

  const timesheetUserId = selectedMember || (user?.id ?? 0);
  const timesheet = trpc.timeAnalytics.timesheet.useQuery(
    { userId: timesheetUserId, weekStart },
    { enabled: timesheetUserId > 0 }
  );

  const startTimer = trpc.timeEntries.startTimer.useMutation({
    onSuccess: () => {
      toast.success("Timer started");
      activeTimer.refetch();
    },
  });

  const stopTimer = trpc.timeEntries.stopTimer.useMutation({
    onSuccess: () => {
      toast.success("Timer stopped");
      activeTimer.refetch();
      timesheet.refetch();
    },
  });

  const createEntry = trpc.timeEntries.create.useMutation({
    onSuccess: () => {
      toast.success("Time entry added");
      setManualOpen(false);
      timesheet.refetch();
    },
  });

  const updateEntry = trpc.timeEntries.update.useMutation({
    onSuccess: () => {
      toast.success("Time entry updated");
      setEditingEntryId(null);
      timesheet.refetch();
    },
  });

  const deleteEntry = trpc.timeEntries.delete.useMutation({
    onSuccess: () => {
      toast.success("Entry deleted");
      timesheet.refetch();
    },
  });

  // Timer tick
  useEffect(() => {
    if (!activeTimer.data) {
      setTimerElapsed(0);
      return;
    }
    const interval = setInterval(() => {
      const start = new Date(activeTimer.data!.startTime).getTime();
      setTimerElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [activeTimer.data]);

  const timerHours = Math.floor(timerElapsed / 3600);
  const timerMinutes = Math.floor((timerElapsed % 3600) / 60);
  const timerSeconds = timerElapsed % 60;

  const handleStartTimer = () => {
    if (!timerProjectId) {
      toast.error("Please select a project");
      return;
    }
    startTimer.mutate({
      projectId: parseInt(timerProjectId),
      description: timerDescription || undefined,
      billable: timerBillable,
      phase: (timerPhase || undefined) as ProjectPhase | undefined,
    });
  };

  const handleStopTimer = () => {
    if (activeTimer.data) {
      stopTimer.mutate({ id: activeTimer.data.id });
    }
  };

  const handleManualEntry = () => {
    if (!manualProjectId) {
      toast.error("Please select a project");
      return;
    }
    const startTime = new Date(`${manualDate}T${manualStartTime}:00`);
    const endTime = new Date(`${manualDate}T${manualEndTime}:00`);
    const durationMinutes = Math.round((endTime.getTime() - startTime.getTime()) / 60000);
    if (durationMinutes <= 0) {
      toast.error("End time must be after start time");
      return;
    }
    createEntry.mutate({
      projectId: parseInt(manualProjectId),
      description: manualDescription || undefined,
      startTime,
      endTime,
      durationMinutes,
      billable: manualBillable,
      phase: (manualPhase || undefined) as ProjectPhase | undefined,
    });
  };

  const startEditing = (entry: any) => {
    setEditingEntryId(entry.id);
    setEditData({
      projectId: entry.projectId?.toString() || "",
      description: entry.description || "",
      date: toDateString(new Date(entry.startTime)),
      startTime: toTimeString(new Date(entry.startTime)),
      endTime: entry.endTime ? toTimeString(new Date(entry.endTime)) : "",
      billable: entry.billable ?? true,
    });
  };

  const handleSaveEdit = () => {
    if (!editingEntryId || !editData.projectId) return;
    const startTime = new Date(`${editData.date}T${editData.startTime}:00`);
    const endTime = editData.endTime ? new Date(`${editData.date}T${editData.endTime}:00`) : undefined;
    const durationMinutes = endTime ? Math.round((endTime.getTime() - startTime.getTime()) / 60000) : undefined;
    if (durationMinutes !== undefined && durationMinutes <= 0) {
      toast.error("End time must be after start time");
      return;
    }
    updateEntry.mutate({
      id: editingEntryId,
      projectId: parseInt(editData.projectId),
      description: editData.description || null,
      startTime,
      endTime: endTime ?? null,
      durationMinutes,
      billable: editData.billable,
    });
  };

  // Week days
  const weekDays = useMemo(() => {
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      days.push(d);
    }
    return days;
  }, [weekStart]);

  const weekEndDate = new Date(weekStart);
  weekEndDate.setDate(weekEndDate.getDate() + 6);

  // Render a single entry row (used in both today's log and week entries)
  const renderEntryRow = (entry: any, compact: boolean = false) => {
    if (editingEntryId === entry.id) {
      return (
        <div key={entry.id} className="p-3 rounded-lg border border-primary/50 bg-primary/5 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div>
              <Label className="text-xs">Project</Label>
              <Select value={editData.projectId} onValueChange={(v) => setEditData(prev => ({ ...prev, projectId: v }))}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {projects.data?.map((p: any) => (
                    <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Description</Label>
              <Input className="h-8 text-xs" value={editData.description} onChange={(e) => setEditData(prev => ({ ...prev, description: e.target.value }))} placeholder="Description" />
            </div>
            <div className="grid grid-cols-3 gap-1 col-span-2">
              <div>
                <Label className="text-xs">Date</Label>
                <Input className="h-8 text-xs" type="date" value={editData.date} onChange={(e) => setEditData(prev => ({ ...prev, date: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">Start</Label>
                <Input className="h-8 text-xs" type="time" value={editData.startTime} onChange={(e) => setEditData(prev => ({ ...prev, startTime: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">End</Label>
                <Input className="h-8 text-xs" type="time" value={editData.endTime} onChange={(e) => setEditData(prev => ({ ...prev, endTime: e.target.value }))} />
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Switch checked={editData.billable} onCheckedChange={(v) => setEditData(prev => ({ ...prev, billable: v }))} />
              <span className="text-xs text-muted-foreground">Billable</span>
            </div>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingEntryId(null)}>
                <X className="h-3 w-3 mr-1" /> Cancel
              </Button>
              <Button size="sm" className="h-7 text-xs" onClick={handleSaveEdit} disabled={updateEntry.isPending}>
                <Check className="h-3 w-3 mr-1" /> Save
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div key={entry.id} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-accent/30 transition-colors group">
        <div className={`w-1 ${compact ? "h-10" : "h-8"} rounded-full ${entry.billable ? "bg-emerald-500" : "bg-muted-foreground/30"}`} />
        {!compact && <span className="text-xs text-muted-foreground w-20">{formatDate(new Date(entry.startTime))}</span>}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm truncate">{entry.projectName}</span>
            {entry.billable && <Badge variant="outline" className="text-xs text-emerald-600 border-emerald-300">{compact ? "Billable" : "B"}</Badge>}
          </div>
          {entry.description && <p className="text-xs text-muted-foreground truncate">{entry.description}</p>}
        </div>
        <div className="text-sm text-muted-foreground">
          {formatTime(entry.startTime)}{entry.endTime ? ` – ${formatTime(entry.endTime)}` : ""}
        </div>
        <div className="font-mono text-sm font-medium w-16 text-right">
          {formatDuration(entry.durationMinutes)}
        </div>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={() => startEditing(entry)}>
            <Pencil className="h-3 w-3" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => deleteEntry.mutate({ id: entry.id })}>
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Time Tracking</h1>
          <p className="text-muted-foreground">Track hours, manage timesheets, and monitor project time</p>
        </div>
        <Dialog open={manualOpen} onOpenChange={setManualOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" /> Log Time</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Log Time Entry</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Project</Label>
                <Select value={manualProjectId} onValueChange={setManualProjectId}>
                  <SelectTrigger><SelectValue placeholder="Select project" /></SelectTrigger>
                  <SelectContent>
                    {projects.data?.map((p: { id: number; name: string }) => (
                      <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Description</Label>
                <Input value={manualDescription} onChange={e => setManualDescription(e.target.value)} placeholder="What did you work on?" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>Date</Label>
                  <Input type="date" value={manualDate} onChange={e => setManualDate(e.target.value)} />
                </div>
                <div>
                  <Label>Start</Label>
                  <Input type="time" value={manualStartTime} onChange={e => setManualStartTime(e.target.value)} />
                </div>
                <div>
                  <Label>End</Label>
                  <Input type="time" value={manualEndTime} onChange={e => setManualEndTime(e.target.value)} />
                </div>
              </div>
              <div>
                <Label>Phase</Label>
                <Select value={manualPhase} onValueChange={(v) => setManualPhase(v as ProjectPhase)}>
                  <SelectTrigger><SelectValue placeholder="Select phase (optional)" /></SelectTrigger>
                  <SelectContent>
                    {PROJECT_PHASES.map((p: { value: string; label: string }) => (
                      <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={manualBillable} onCheckedChange={setManualBillable} />
                <Label>Billable</Label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setManualOpen(false)}>Cancel</Button>
              <Button onClick={handleManualEntry} disabled={createEntry.isPending}>Save Entry</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="timer"><Timer className="h-4 w-4 mr-1" /> Timer</TabsTrigger>
          <TabsTrigger value="timesheet"><Calendar className="h-4 w-4 mr-1" /> Timesheet</TabsTrigger>
          {isAdmin && <TabsTrigger value="teamreport"><FileSpreadsheet className="h-4 w-4 mr-1" /> Team Report</TabsTrigger>}
        </TabsList>

        <TabsContent value="timer" className="space-y-6">
          {/* Active Timer */}
          <Card className={activeTimer.data ? "border-primary/50 bg-primary/5" : ""}>
            <CardContent className="pt-6">
              <div className="flex flex-col md:flex-row items-center gap-6">
                {/* Timer display */}
                <div className="text-center md:text-left">
                  <div className="font-mono text-5xl font-bold tracking-wider tabular-nums">
                    {String(timerHours).padStart(2, "0")}:{String(timerMinutes).padStart(2, "0")}:{String(timerSeconds).padStart(2, "0")}
                  </div>
                  {activeTimer.data && (
                    <p className="text-sm text-muted-foreground mt-1">
                      {projects.data?.find((p: any) => p.id === activeTimer.data?.projectId)?.name ?? "Unknown project"}
                      {activeTimer.data.description && ` — ${activeTimer.data.description}`}
                    </p>
                  )}
                </div>

                {/* Timer controls */}
                <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3 w-full md:w-auto">
                  {!activeTimer.data && (
                    <>
                      <Select value={timerProjectId} onValueChange={setTimerProjectId}>
                        <SelectTrigger><SelectValue placeholder="Select project" /></SelectTrigger>
                        <SelectContent>
                          {projects.data?.map((p: { id: number; name: string }) => (
                            <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input value={timerDescription} onChange={e => setTimerDescription(e.target.value)} placeholder="What are you working on?" />
                      <Select value={timerPhase} onValueChange={(v) => setTimerPhase(v as ProjectPhase)}>
                        <SelectTrigger><SelectValue placeholder="Phase (optional)" /></SelectTrigger>
                        <SelectContent>
                          {PROJECT_PHASES.map((p: { value: string; label: string }) => (
                            <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <div className="flex items-center gap-2">
                        <Switch checked={timerBillable} onCheckedChange={setTimerBillable} />
                        <Label className="text-sm">Billable</Label>
                      </div>
                    </>
                  )}
                </div>

                {activeTimer.data ? (
                  <Button size="lg" variant="destructive" onClick={handleStopTimer} disabled={stopTimer.isPending}>
                    <Square className="h-5 w-5 mr-2" /> Stop
                  </Button>
                ) : (
                  <Button size="lg" onClick={handleStartTimer} disabled={startTimer.isPending}>
                    <Play className="h-5 w-5 mr-2" /> Start
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Today's entries */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Today's Time Log</CardTitle>
            </CardHeader>
            <CardContent>
              {(() => {
                const today = new Date().toISOString().split("T")[0];
                const todayEntries = timesheet.data?.entries?.filter((e: any) =>
                  new Date(e.startTime).toISOString().split("T")[0] === today && e.endTime
                ) || [];
                const todayTotal = todayEntries.reduce((s: number, e: any) => s + e.durationMinutes, 0);

                if (todayEntries.length === 0) {
                  return <p className="text-muted-foreground text-center py-8">No time logged today. Start the timer or log time manually.</p>;
                }

                return (
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm text-muted-foreground mb-3">
                      <span>{todayEntries.length} entries</span>
                      <span className="font-semibold text-foreground">{formatDuration(todayTotal)}</span>
                    </div>
                    {todayEntries.map((entry: any) => renderEntryRow(entry, true))}
                  </div>
                );
              })()}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="timesheet" className="space-y-6">
          {/* Week navigation */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <Button variant="outline" size="icon" onClick={() => setWeekOffset(w => w - 1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <div className="text-center">
                  <h3 className="font-semibold">
                    {formatDate(weekStart)} – {formatDate(weekEndDate)}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Total: <span className="font-semibold text-foreground">{formatDuration(timesheet.data?.weekTotal || 0)}</span>
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {isAdmin && (
                    <Select value={selectedMember?.toString() || ""} onValueChange={v => setSelectedMember(v ? parseInt(v) : null)}>
                      <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder="My Timesheet" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">My Timesheet</SelectItem>
                        {teamMembers.data?.map((m: any) => (
                          <SelectItem key={m.id} value={m.id.toString()}>{m.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <Button variant="outline" size="sm" onClick={() => setWeekOffset(0)}>This Week</Button>
                  <Button variant="outline" size="icon" onClick={() => setWeekOffset(w => w + 1)}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Daily breakdown */}
          <div className="grid grid-cols-7 gap-2">
            {weekDays.map((day, i) => {
              const dayKey = day.toISOString().split("T")[0];
              const dayMinutes = timesheet.data?.dailyTotals?.[dayKey] || 0;
              const isToday = dayKey === new Date().toISOString().split("T")[0];
              const isWeekend = i >= 5;

              return (
                <Card key={dayKey} className={`${isToday ? "border-primary/50 bg-primary/5" : ""} ${isWeekend ? "opacity-60" : ""}`}>
                  <CardContent className="p-3 text-center">
                    <p className="text-xs font-medium text-muted-foreground">{day.toLocaleDateString("en-US", { weekday: "short" })}</p>
                    <p className="text-lg font-bold mt-1">{day.getDate()}</p>
                    <p className={`text-sm font-mono mt-1 ${dayMinutes > 0 ? "text-primary font-semibold" : "text-muted-foreground"}`}>
                      {dayMinutes > 0 ? formatDuration(dayMinutes) : "—"}
                    </p>
                    {dayMinutes > 0 && (
                      <div className="w-full bg-muted rounded-full h-1 mt-2">
                        <div className="bg-primary rounded-full h-1" style={{ width: `${Math.min(100, (dayMinutes / 480) * 100)}%` }} />
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Entries list */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Week Entries</CardTitle>
            </CardHeader>
            <CardContent>
              {!timesheet.data?.entries?.length ? (
                <p className="text-muted-foreground text-center py-8">No time entries for this week.</p>
              ) : (
                <div className="space-y-1">
                  {timesheet.data.entries.filter((e: any) => e.endTime).map((entry: any) => renderEntryRow(entry, false))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Admin Team Time Report Tab */}
        {isAdmin && (
          <TabsContent value="teamreport" className="space-y-6">
            {/* Date range filter */}
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">Team Time Report</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Label className="text-xs text-muted-foreground">From</Label>
                    <Input type="date" className="w-[160px] h-8 text-xs" value={reportStartDate} onChange={e => setReportStartDate(e.target.value)} />
                  </div>
                  <div className="flex items-center gap-2">
                    <Label className="text-xs text-muted-foreground">To</Label>
                    <Input type="date" className="w-[160px] h-8 text-xs" value={reportEndDate} onChange={e => setReportEndDate(e.target.value)} />
                  </div>
                  {(reportStartDate || reportEndDate) && (
                    <Button variant="ghost" size="sm" className="text-xs" onClick={() => { setReportStartDate(""); setReportEndDate(""); }}>Clear</Button>
                  )}
                  <div className="ml-auto">
                    <Button variant="outline" size="sm" className="gap-1.5" onClick={() => {
                      if (!teamTimeReport.data) return;
                      const { rows, projects: prjs } = teamTimeReport.data;
                      const escapeCSV = (v: any) => {
                        const s = String(v ?? "");
                        return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
                      };
                      const headers = ["Team Member", "Title", "Rate ($/hr)", "Total Hours", "Billable Hours", "Labor Cost"];
                      prjs.forEach(p => headers.push(escapeCSV(p.name) + " (hrs)"));
                      const csvRows = rows.map(r => {
                        const row = [escapeCSV(r.memberName), escapeCSV(r.title || ""), (r.billingRate / 100).toFixed(2), r.totalHours.toFixed(2), r.billableHours.toFixed(2), (r.laborCost / 100).toFixed(2)];
                        prjs.forEach(p => {
                          const pb = r.projectBreakdown.find((b: any) => b.projectId === p.id);
                          row.push(pb ? pb.totalHours.toFixed(2) : "0.00");
                        });
                        return row.join(",");
                      });
                      const csv = [headers.join(","), ...csvRows].join("\n");
                      const blob = new Blob([csv], { type: "text/csv" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      const dateRange = reportStartDate && reportEndDate ? `${reportStartDate}_to_${reportEndDate}` : "all-time";
                      a.download = `team-time-report-${dateRange}.csv`;
                      a.click();
                      URL.revokeObjectURL(url);
                      toast.success("Team time report exported");
                    }}>
                      <Download className="h-3.5 w-3.5" /> Export CSV
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Spreadsheet table */}
            <Card>
              <CardContent className="p-0">
                {teamTimeReport.isLoading ? (
                  <div className="p-8 text-center text-muted-foreground">Loading team time data...</div>
                ) : !teamTimeReport.data?.rows.length ? (
                  <div className="p-8 text-center text-muted-foreground">
                    <Users className="h-10 w-10 mx-auto mb-2 opacity-40" />
                    <p>No time data found for the selected period.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50">
                        <tr className="border-b">
                          <th className="text-left p-3 font-medium text-muted-foreground sticky left-0 bg-muted/50 min-w-[160px]">Team Member</th>
                          <th className="text-right p-3 font-medium text-muted-foreground min-w-[80px]">Rate</th>
                          <th className="text-right p-3 font-medium text-muted-foreground min-w-[80px]">Total Hrs</th>
                          <th className="text-right p-3 font-medium text-muted-foreground min-w-[80px]">Billable Hrs</th>
                          <th className="text-right p-3 font-medium text-muted-foreground min-w-[90px]">Labor Cost</th>
                          {teamTimeReport.data.projects.map((p: any) => (
                            <th key={p.id} className="text-right p-3 font-medium text-muted-foreground min-w-[90px]">{p.name}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {teamTimeReport.data.rows.map((r: any) => (
                          <tr key={r.memberId} className="border-b last:border-0 hover:bg-accent/30 transition-colors">
                            <td className="p-3 sticky left-0 bg-background">
                              <div>
                                <span className="font-medium">{r.memberName}</span>
                                {r.title && <span className="text-muted-foreground ml-1">({r.title})</span>}
                              </div>
                            </td>
                            <td className="p-3 text-right font-mono">${(r.billingRate / 100).toFixed(0)}/hr</td>
                            <td className="p-3 text-right font-mono font-semibold">{r.totalHours.toFixed(1)}</td>
                            <td className="p-3 text-right font-mono text-emerald-600">{r.billableHours.toFixed(1)}</td>
                            <td className="p-3 text-right font-mono font-semibold">${(r.laborCost / 100).toLocaleString()}</td>
                            {teamTimeReport.data!.projects.map((p: any) => {
                              const pb = r.projectBreakdown.find((b: any) => b.projectId === p.id);
                              return (
                                <td key={p.id} className={`p-3 text-right font-mono ${pb && pb.totalHours > 0 ? "text-foreground" : "text-muted-foreground/40"}`}>
                                  {pb && pb.totalHours > 0 ? pb.totalHours.toFixed(1) : "—"}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                        {/* Totals row */}
                        <tr className="bg-muted/30 font-semibold border-t-2">
                          <td className="p-3 sticky left-0 bg-muted/30">Totals</td>
                          <td className="p-3"></td>
                          <td className="p-3 text-right font-mono">{teamTimeReport.data.rows.reduce((s: number, r: any) => s + r.totalHours, 0).toFixed(1)}</td>
                          <td className="p-3 text-right font-mono text-emerald-600">{teamTimeReport.data.rows.reduce((s: number, r: any) => s + r.billableHours, 0).toFixed(1)}</td>
                          <td className="p-3 text-right font-mono">${(teamTimeReport.data.rows.reduce((s: number, r: any) => s + r.laborCost, 0) / 100).toLocaleString()}</td>
                          {teamTimeReport.data.projects.map((p: any) => {
                            const total = teamTimeReport.data!.rows.reduce((s: number, r: any) => {
                              const pb = r.projectBreakdown.find((b: any) => b.projectId === p.id);
                              return s + (pb ? pb.totalHours : 0);
                            }, 0);
                            return <td key={p.id} className={`p-3 text-right font-mono ${total > 0 ? "" : "text-muted-foreground/40"}`}>{total > 0 ? total.toFixed(1) : "—"}</td>;
                          })}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Summary info */}
            {teamTimeReport.data && teamTimeReport.data.rows.length > 0 && (
              <div className="text-xs text-muted-foreground text-center">
                Showing {teamTimeReport.data.rows.length} team members across {teamTimeReport.data.projects.length} projects
                {reportStartDate && reportEndDate && ` from ${reportStartDate} to ${reportEndDate}`}
                {reportStartDate && !reportEndDate && ` from ${reportStartDate}`}
                {!reportStartDate && reportEndDate && ` through ${reportEndDate}`}
                {!reportStartDate && !reportEndDate && " (all time)"}
              </div>
            )}
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
