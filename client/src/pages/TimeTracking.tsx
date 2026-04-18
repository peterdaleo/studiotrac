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
import { Play, Square, Clock, Plus, Calendar, ChevronLeft, ChevronRight, Timer, Trash2, Edit2, Check, X } from "lucide-react";
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

  const projects = trpc.projects.list.useQuery();
  const teamMembers = trpc.teamMembers.list.useQuery();
  const activeTimer = trpc.timeEntries.activeTimer.useQuery(undefined, { refetchInterval: 1000 });

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
                      {projects.data?.find((p: any) => p.id === activeTimer.data?.projectId)?.name || "Unknown project"}
                      {activeTimer.data.description && ` — ${activeTimer.data.description}`}
                    </p>
                  )}
                </div>

                <div className="flex-1 w-full md:w-auto">
                  {!activeTimer.data ? (
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                      <Select value={timerProjectId} onValueChange={setTimerProjectId}>
                        <SelectTrigger><SelectValue placeholder="Project" /></SelectTrigger>
                        <SelectContent>
                          {projects.data?.map((p: { id: number; name: string }) => (
                            <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        value={timerDescription}
                        onChange={e => setTimerDescription(e.target.value)}
                        placeholder="Description..."
                      />
                      <Select value={timerPhase} onValueChange={(v) => setTimerPhase(v as ProjectPhase)}>
                        <SelectTrigger><SelectValue placeholder="Phase" /></SelectTrigger>
                        <SelectContent>
                          {PROJECT_PHASES.map((p: { value: string; label: string }) => (
                            <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <div className="flex items-center gap-2">
                        <Switch checked={timerBillable} onCheckedChange={setTimerBillable} />
                        <span className="text-sm">Billable</span>
                      </div>
                    </div>
                  ) : null}
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
                    {todayEntries.map((entry: any) => (
                      <div key={entry.id} className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-accent/30 transition-colors">
                        <div className={`w-1 h-10 rounded-full ${entry.billable ? "bg-emerald-500" : "bg-muted-foreground/30"}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm truncate">{entry.projectName}</span>
                            {entry.billable && <Badge variant="outline" className="text-xs text-emerald-600 border-emerald-300">Billable</Badge>}
                          </div>
                          {entry.description && <p className="text-xs text-muted-foreground truncate">{entry.description}</p>}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {formatTime(entry.startTime)} – {formatTime(entry.endTime)}
                        </div>
                        <div className="font-mono text-sm font-medium w-16 text-right">
                          {formatDuration(entry.durationMinutes)}
                        </div>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => deleteEntry.mutate({ id: entry.id })}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
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
                  {timesheet.data.entries.filter((e: any) => e.endTime).map((entry: any) => (
                    <div key={entry.id} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-accent/30 transition-colors">
                      <div className={`w-1 h-8 rounded-full ${entry.billable ? "bg-emerald-500" : "bg-muted-foreground/30"}`} />
                      <span className="text-xs text-muted-foreground w-20">{formatDate(new Date(entry.startTime))}</span>
                      <span className="font-medium text-sm flex-1 truncate">{entry.projectName}</span>
                      {entry.description && <span className="text-xs text-muted-foreground truncate max-w-[200px]">{entry.description}</span>}
                      {entry.billable && <Badge variant="outline" className="text-xs text-emerald-600 border-emerald-300">B</Badge>}
                      <span className="text-xs text-muted-foreground">{formatTime(entry.startTime)}–{entry.endTime ? formatTime(entry.endTime) : "..."}</span>
                      <span className="font-mono text-sm font-medium w-14 text-right">{formatDuration(entry.durationMinutes)}</span>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => deleteEntry.mutate({ id: entry.id })}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
