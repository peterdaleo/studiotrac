import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  Clock,
  FolderKanban,
  CheckSquare,
  Plus,
  Pencil,
  Trash2,
  Users,
} from "lucide-react";
import { useLocation } from "wouter";
import { toast } from "sonner";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

type AbsenceType = "full_day" | "partial_day" | "work_from_home";

type CalendarEventType = "project_deadline" | "task_deadline" | "absence";

interface CalendarEvent {
  id: string;
  title: string;
  date: Date;
  type: CalendarEventType;
  projectId?: number;
  status?: string;
  isOverdue?: boolean;
  absenceId?: number;
  absenceType?: AbsenceType;
  teamMemberId?: number;
  teamMemberName?: string;
  notes?: string | null;
  startTimeMinutes?: number | null;
  endTimeMinutes?: number | null;
  rangeStart?: Date;
  rangeEnd?: Date;
}

interface AbsenceFormState {
  teamMemberId: string;
  absenceType: AbsenceType;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  notes: string;
}

const ABSENCE_TYPE_LABELS: Record<AbsenceType, string> = {
  full_day: "Full day off",
  partial_day: "Partial day",
  work_from_home: "Work from home",
};

const ABSENCE_EVENT_LABELS: Record<AbsenceType, string> = {
  full_day: "Out",
  partial_day: "Partial",
  work_from_home: "WFH",
};

const ABSENCE_STYLES: Record<AbsenceType, string> = {
  full_day: "border border-rose-200 bg-rose-50 text-rose-700",
  partial_day: "border border-amber-200 bg-amber-50 text-amber-700",
  work_from_home: "border border-emerald-200 bg-emerald-50 text-emerald-700",
};

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function formatDateKey(date: Date) {
  return startOfDay(date).toISOString().split("T")[0];
}

function formatDateInput(date: Date) {
  return new Date(date).toISOString().split("T")[0];
}

function createAbsenceFormState(date = new Date()): AbsenceFormState {
  const day = formatDateInput(date);
  return {
    teamMemberId: "",
    absenceType: "full_day",
    startDate: day,
    endDate: day,
    startTime: "09:00",
    endTime: "13:00",
    notes: "",
  };
}

function minutesToTimeString(minutes?: number | null) {
  if (minutes == null) return "";
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

function timeStringToMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function formatMinutesRange(startMinutes?: number | null, endMinutes?: number | null) {
  if (startMinutes == null || endMinutes == null) return "";
  const start = minutesToTimeString(startMinutes);
  const end = minutesToTimeString(endMinutes);
  return `${start}–${end}`;
}

function isSameDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function sortEvents(a: CalendarEvent, b: CalendarEvent) {
  const order: Record<CalendarEventType, number> = {
    absence: 0,
    project_deadline: 1,
    task_deadline: 2,
  };

  if (order[a.type] !== order[b.type]) {
    return order[a.type] - order[b.type];
  }

  if (a.type === "absence" && b.type === "absence") {
    return (a.teamMemberName ?? "").localeCompare(b.teamMemberName ?? "");
  }

  return a.title.localeCompare(b.title);
}

export default function CalendarView() {
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();

  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(() => new Date());
  const [absenceDialogOpen, setAbsenceDialogOpen] = useState(false);
  const [editingAbsenceId, setEditingAbsenceId] = useState<number | null>(null);
  const [absenceForm, setAbsenceForm] = useState<AbsenceFormState>(() => createAbsenceFormState());

  const { data: projects, isLoading: projectsLoading } = trpc.projects.list.useQuery({});
  const { data: tasks, isLoading: tasksLoading } = trpc.tasks.list.useQuery({});
  const { data: teamMembers, isLoading: teamMembersLoading } = trpc.teamMembers.list.useQuery();

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const calendarDays = useMemo(() => {
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startPad = firstDay.getDay();
    const days: { date: Date; isCurrentMonth: boolean }[] = [];

    for (let i = startPad - 1; i >= 0; i--) {
      days.push({
        date: new Date(year, month, -i),
        isCurrentMonth: false,
      });
    }

    for (let d = 1; d <= lastDay.getDate(); d++) {
      days.push({ date: new Date(year, month, d), isCurrentMonth: true });
    }

    const remaining = 42 - days.length;
    for (let i = 1; i <= remaining; i++) {
      days.push({
        date: new Date(year, month + 1, i),
        isCurrentMonth: false,
      });
    }

    return days;
  }, [year, month]);

  const absenceQueryInput = useMemo(() => ({
    startDate: startOfDay(calendarDays[0]?.date ?? new Date(year, month, 1)),
    endDate: endOfDay(calendarDays[calendarDays.length - 1]?.date ?? new Date(year, month + 1, 0)),
  }), [calendarDays, month, year]);

  const { data: absences, isLoading: absencesLoading } = trpc.teamAbsences.list.useQuery(absenceQueryInput);

  const createAbsence = trpc.teamAbsences.create.useMutation({
    onSuccess: async () => {
      await utils.teamAbsences.list.invalidate();
      toast.success("Absence added");
      setAbsenceDialogOpen(false);
      setEditingAbsenceId(null);
      setAbsenceForm(createAbsenceFormState(selectedDate ?? new Date()));
    },
    onError: (error) => toast.error(error.message || "Failed to add absence"),
  });

  const updateAbsence = trpc.teamAbsences.update.useMutation({
    onSuccess: async () => {
      await utils.teamAbsences.list.invalidate();
      toast.success("Absence updated");
      setAbsenceDialogOpen(false);
      setEditingAbsenceId(null);
      setAbsenceForm(createAbsenceFormState(selectedDate ?? new Date()));
    },
    onError: (error) => toast.error(error.message || "Failed to update absence"),
  });

  const deleteAbsence = trpc.teamAbsences.delete.useMutation({
    onSuccess: async () => {
      await utils.teamAbsences.list.invalidate();
      toast.success("Absence deleted");
    },
    onError: (error) => toast.error(error.message || "Failed to delete absence"),
  });

  const events = useMemo(() => {
    const evts: CalendarEvent[] = [];

    projects?.forEach((project) => {
      if (!project.deadline) return;
      evts.push({
        id: `project-${project.id}`,
        title: project.name,
        date: new Date(project.deadline),
        type: "project_deadline",
        projectId: project.id,
        status: project.status,
        isOverdue: new Date(project.deadline) < new Date() && project.status !== "completed",
      });
    });

    tasks?.forEach((task) => {
      if (!task.deadline || task.status === "done") return;
      evts.push({
        id: `task-${task.id}`,
        title: task.title,
        date: new Date(task.deadline),
        type: "task_deadline",
        projectId: task.projectId,
        isOverdue: new Date(task.deadline) < new Date(),
      });
    });

    absences?.forEach((absence) => {
      const rangeStart = startOfDay(new Date(absence.startDate));
      const rangeEnd = startOfDay(new Date(absence.endDate));
      let cursor = new Date(rangeStart);

      while (cursor <= rangeEnd) {
        evts.push({
          id: `absence-${absence.id}-${formatDateKey(cursor)}`,
          title: absence.teamMemberName,
          date: new Date(cursor),
          type: "absence",
          absenceId: absence.id,
          absenceType: absence.absenceType,
          teamMemberId: absence.teamMemberId,
          teamMemberName: absence.teamMemberName,
          notes: absence.notes,
          startTimeMinutes: absence.startTimeMinutes,
          endTimeMinutes: absence.endTimeMinutes,
          rangeStart: new Date(absence.startDate),
          rangeEnd: new Date(absence.endDate),
        });
        cursor = addDays(cursor, 1);
      }
    });

    return evts.sort(sortEvents);
  }, [absences, projects, tasks]);

  const getEventsForDate = (date: Date) => {
    return events.filter((event) => isSameDay(event.date, date)).sort(sortEvents);
  };

  const selectedEvents = selectedDate ? getEventsForDate(selectedDate) : [];
  const selectedAbsences = selectedEvents.filter((event) => event.type === "absence");
  const selectedScheduleItems = selectedEvents.filter((event) => event.type !== "absence");

  const monthlyAbsenceSummary = useMemo(() => {
    const dayMap = new Map<string, { out: number; partial: number; wfh: number }>();

    absences?.forEach((absence) => {
      const rangeStart = startOfDay(new Date(absence.startDate));
      const rangeEnd = startOfDay(new Date(absence.endDate));
      let cursor = new Date(rangeStart);

      while (cursor <= rangeEnd) {
        const key = formatDateKey(cursor);
        const entry = dayMap.get(key) ?? { out: 0, partial: 0, wfh: 0 };
        if (absence.absenceType === "full_day") entry.out += 1;
        if (absence.absenceType === "partial_day") entry.partial += 1;
        if (absence.absenceType === "work_from_home") entry.wfh += 1;
        dayMap.set(key, entry);
        cursor = addDays(cursor, 1);
      }
    });

    return dayMap;
  }, [absences]);

  const openCreateAbsenceDialog = (date?: Date) => {
    const targetDate = date ?? selectedDate ?? new Date();
    setEditingAbsenceId(null);
    setAbsenceForm(createAbsenceFormState(targetDate));
    setAbsenceDialogOpen(true);
  };

  const openEditAbsenceDialog = (event: CalendarEvent) => {
    if (!event.absenceId || !event.teamMemberId || !event.absenceType) return;
    setEditingAbsenceId(event.absenceId);
    setAbsenceForm({
      teamMemberId: String(event.teamMemberId),
      absenceType: event.absenceType,
      startDate: formatDateInput(event.rangeStart ?? event.date),
      endDate: formatDateInput(event.rangeEnd ?? event.date),
      startTime: minutesToTimeString(event.startTimeMinutes) || "09:00",
      endTime: minutesToTimeString(event.endTimeMinutes) || "13:00",
      notes: event.notes ?? "",
    });
    setAbsenceDialogOpen(true);
  };

  const handleAbsenceTypeChange = (nextType: AbsenceType) => {
    setAbsenceForm((current) => ({
      ...current,
      absenceType: nextType,
      endDate: nextType === "partial_day" ? current.startDate : current.endDate,
    }));
  };

  const handleSaveAbsence = () => {
    if (!absenceForm.teamMemberId) {
      toast.error("Please select a team member");
      return;
    }

    if (absenceForm.absenceType === "partial_day") {
      if (!absenceForm.startTime || !absenceForm.endTime) {
        toast.error("Please enter a start and end time for a partial day absence");
        return;
      }
      if (timeStringToMinutes(absenceForm.endTime) <= timeStringToMinutes(absenceForm.startTime)) {
        toast.error("End time must be after the start time");
        return;
      }
    }

    const normalizedEndDate = absenceForm.absenceType === "partial_day" ? absenceForm.startDate : absenceForm.endDate;
    const startDate = new Date(`${absenceForm.startDate}T00:00:00`);
    const endDate = new Date(`${normalizedEndDate}T23:59:59`);

    if (endDate < startDate) {
      toast.error("End date must be on or after the start date");
      return;
    }

    const payload = {
      teamMemberId: Number(absenceForm.teamMemberId),
      absenceType: absenceForm.absenceType,
      startDate,
      endDate,
      startTimeMinutes: absenceForm.absenceType === "partial_day" ? timeStringToMinutes(absenceForm.startTime) : null,
      endTimeMinutes: absenceForm.absenceType === "partial_day" ? timeStringToMinutes(absenceForm.endTime) : null,
      notes: absenceForm.notes.trim() || undefined,
    };

    if (editingAbsenceId) {
      updateAbsence.mutate({ id: editingAbsenceId, ...payload });
      return;
    }

    createAbsence.mutate(payload);
  };

  const handleDeleteAbsence = (absenceId: number) => {
    if (!window.confirm("Delete this absence entry?")) return;
    deleteAbsence.mutate({ id: absenceId });
  };

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));
  const goToday = () => {
    const today = new Date();
    setCurrentDate(today);
    setSelectedDate(today);
  };

  const isToday = (date: Date) => isSameDay(date, new Date());

  const isSelected = (date: Date) => {
    if (!selectedDate) return false;
    return isSameDay(date, selectedDate);
  };

  if (projectsLoading || tasksLoading || teamMembersLoading || absencesLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-[500px] rounded-xl" />
      </div>
    );
  }

  return (
    <>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Calendar</h1>
            <p className="mt-1 text-muted-foreground">
              Project deadlines, task milestones, and team availability in one place.
            </p>
          </div>
          <Button onClick={() => openCreateAbsenceDialog()}>
            <Plus className="mr-2 h-4 w-4" />
            Add absence
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
          <Card className="border-0 shadow-sm lg:col-span-3">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-4">
                <CardTitle className="text-lg font-semibold">
                  {MONTHS[month]} {year}
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={goToday}>
                    Today
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={prevMonth}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={nextMonth}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="mb-2 grid grid-cols-7">
                {DAYS.map((day) => (
                  <div key={day} className="py-2 text-center text-xs font-medium text-muted-foreground">
                    {day}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg bg-border">
                {calendarDays.map((day, index) => {
                  const dayEvents = getEventsForDate(day.date);
                  const dayAbsences = dayEvents.filter((event) => event.type === "absence");
                  const otherEvents = dayEvents.filter((event) => event.type !== "absence");
                  const summary = monthlyAbsenceSummary.get(formatDateKey(day.date));
                  const previewEvents = [...dayAbsences.slice(0, 2), ...otherEvents.slice(0, Math.max(0, 2 - dayAbsences.slice(0, 2).length))];
                  const hiddenCount = dayEvents.length - previewEvents.length;

                  return (
                    <button
                      key={index}
                      onClick={() => setSelectedDate(day.date)}
                      className={`min-h-[108px] bg-card p-1.5 text-left transition-colors hover:bg-muted/50 ${
                        !day.isCurrentMonth ? "opacity-40" : ""
                      } ${isSelected(day.date) ? "ring-2 ring-primary ring-inset" : ""}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span
                          className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
                            isToday(day.date) ? "bg-primary text-primary-foreground" : ""
                          }`}
                        >
                          {day.date.getDate()}
                        </span>
                        {summary && (summary.out > 0 || summary.partial > 0 || summary.wfh > 0) ? (
                          <div className="flex flex-wrap justify-end gap-1">
                            {summary.out > 0 && (
                              <span className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[9px] font-medium text-rose-700">
                                {summary.out} out
                              </span>
                            )}
                            {summary.partial > 0 && (
                              <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-medium text-amber-700">
                                {summary.partial} partial
                              </span>
                            )}
                            {summary.wfh > 0 && (
                              <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-medium text-emerald-700">
                                {summary.wfh} WFH
                              </span>
                            )}
                          </div>
                        ) : null}
                      </div>

                      <div className="mt-1 space-y-1">
                        {previewEvents.map((event) => (
                          <div
                            key={event.id}
                            className={`truncate rounded px-1.5 py-1 text-[9px] leading-tight ${
                              event.type === "absence"
                                ? ABSENCE_STYLES[event.absenceType ?? "full_day"]
                                : event.isOverdue
                                ? "bg-red-100 text-red-700"
                                : event.type === "project_deadline"
                                ? "bg-primary/10 text-primary"
                                : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {event.type === "absence"
                              ? `${ABSENCE_EVENT_LABELS[event.absenceType ?? "full_day"]} · ${event.teamMemberName}`
                              : event.title}
                          </div>
                        ))}
                        {hiddenCount > 0 && (
                          <div className="px-1 text-[9px] text-muted-foreground">+{hiddenCount} more</div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <CardTitle className="text-base font-semibold">
                    {selectedDate
                      ? selectedDate.toLocaleDateString("en-US", {
                          weekday: "long",
                          month: "long",
                          day: "numeric",
                        })
                      : "Select a date"}
                  </CardTitle>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => openCreateAbsenceDialog(selectedDate ?? new Date())}
                  >
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    Add
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {!selectedDate ? (
                  <p className="text-sm text-muted-foreground">Click a date to see events and availability.</p>
                ) : (
                  <>
                    <div className="rounded-xl bg-muted/40 p-3">
                      <div className="mb-2 flex items-center gap-2">
                        <Users className="h-4 w-4 text-muted-foreground" />
                        <p className="text-sm font-medium">Team availability</p>
                      </div>

                      {selectedAbsences.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No absences or work-from-home entries on this date.</p>
                      ) : (
                        <div className="space-y-3">
                          {selectedAbsences.map((event) => (
                            <div key={event.id} className="rounded-lg border border-border bg-background p-3">
                              <div className="flex items-start justify-between gap-3">
                                <div className="space-y-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className="text-sm font-medium">{event.teamMemberName}</p>
                                    <Badge className={ABSENCE_STYLES[event.absenceType ?? "full_day"]}>
                                      {ABSENCE_TYPE_LABELS[event.absenceType ?? "full_day"]}
                                    </Badge>
                                  </div>
                                  {event.absenceType === "partial_day" && (
                                    <p className="text-xs text-muted-foreground">
                                      {formatMinutesRange(event.startTimeMinutes, event.endTimeMinutes)}
                                    </p>
                                  )}
                                  {event.rangeStart && event.rangeEnd && !isSameDay(event.rangeStart, event.rangeEnd) && (
                                    <p className="text-xs text-muted-foreground">
                                      {event.rangeStart.toLocaleDateString()} – {event.rangeEnd.toLocaleDateString()}
                                    </p>
                                  )}
                                  {event.notes ? (
                                    <p className="text-sm text-muted-foreground">{event.notes}</p>
                                  ) : null}
                                </div>

                                <div className="flex items-center gap-1">
                                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditAbsenceDialog(event)}>
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                  {event.absenceId ? (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8 text-destructive hover:text-destructive"
                                      onClick={() => handleDeleteAbsence(event.absenceId!)}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div>
                      <div className="mb-2 flex items-center gap-2">
                        <CalendarDays className="h-4 w-4 text-muted-foreground" />
                        <p className="text-sm font-medium">Project schedule</p>
                      </div>

                      {selectedScheduleItems.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No project or task deadlines on this date.</p>
                      ) : (
                        <div className="space-y-3">
                          {selectedScheduleItems.map((event) => (
                            <button
                              key={event.id}
                              onClick={() => event.projectId && setLocation(`/projects/${event.projectId}`)}
                              className="w-full rounded-lg bg-muted/50 p-3 text-left transition-colors hover:bg-muted"
                            >
                              <div className="mb-1 flex items-center gap-2">
                                {event.type === "project_deadline" ? (
                                  <FolderKanban className="h-3.5 w-3.5 text-primary" />
                                ) : (
                                  <CheckSquare className="h-3.5 w-3.5 text-muted-foreground" />
                                )}
                                <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                  {event.type === "project_deadline" ? "Project Deadline" : "Task Due"}
                                </span>
                                {event.isOverdue ? (
                                  <Badge variant="destructive" className="h-4 px-1 text-[9px]">
                                    Overdue
                                  </Badge>
                                ) : null}
                              </div>
                              <p className="text-sm font-medium">{event.title}</p>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <Card className="border-0 shadow-sm">
              <CardContent className="space-y-3 p-4">
                <p className="text-xs font-medium text-muted-foreground">Legend</p>
                <div className="flex items-center gap-2">
                  <div className="h-2.5 w-2.5 rounded-sm bg-rose-200" />
                  <span className="text-xs">Full day off</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-2.5 w-2.5 rounded-sm bg-amber-200" />
                  <span className="text-xs">Partial day</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-2.5 w-2.5 rounded-sm bg-emerald-200" />
                  <span className="text-xs">Work from home</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-2.5 w-2.5 rounded-sm bg-primary/30" />
                  <span className="text-xs">Project deadline</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-2.5 w-2.5 rounded-sm bg-muted" />
                  <span className="text-xs">Task due date</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-2.5 w-2.5 rounded-sm bg-red-200" />
                  <span className="text-xs">Overdue</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <Dialog
        open={absenceDialogOpen}
        onOpenChange={(open) => {
          setAbsenceDialogOpen(open);
          if (!open) {
            setEditingAbsenceId(null);
            setAbsenceForm(createAbsenceFormState(selectedDate ?? new Date()));
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingAbsenceId ? "Edit absence" : "Add absence"}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Team member</Label>
              <Select
                value={absenceForm.teamMemberId}
                onValueChange={(value) => setAbsenceForm((current) => ({ ...current, teamMemberId: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a team member" />
                </SelectTrigger>
                <SelectContent>
                  {teamMembers?.map((member) => (
                    <SelectItem key={member.id} value={String(member.id)}>
                      {member.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label>Absence type</Label>
              <Select value={absenceForm.absenceType} onValueChange={(value) => handleAbsenceTypeChange(value as AbsenceType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="full_day">Full day off</SelectItem>
                  <SelectItem value="partial_day">Partial day</SelectItem>
                  <SelectItem value="work_from_home">Work from home</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className={`grid gap-4 ${absenceForm.absenceType === "partial_day" ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2"}`}>
              <div className="grid gap-2">
                <Label>{absenceForm.absenceType === "partial_day" ? "Date" : "Start date"}</Label>
                <Input
                  type="date"
                  value={absenceForm.startDate}
                  onChange={(event) => setAbsenceForm((current) => ({
                    ...current,
                    startDate: event.target.value,
                    endDate: current.absenceType === "partial_day" ? event.target.value : current.endDate,
                  }))}
                />
              </div>
              {absenceForm.absenceType !== "partial_day" && (
                <div className="grid gap-2">
                  <Label>End date</Label>
                  <Input
                    type="date"
                    value={absenceForm.endDate}
                    onChange={(event) => setAbsenceForm((current) => ({ ...current, endDate: event.target.value }))}
                  />
                </div>
              )}
            </div>

            {absenceForm.absenceType === "partial_day" && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label>Start time</Label>
                  <Input
                    type="time"
                    value={absenceForm.startTime}
                    onChange={(event) => setAbsenceForm((current) => ({ ...current, startTime: event.target.value }))}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>End time</Label>
                  <Input
                    type="time"
                    value={absenceForm.endTime}
                    onChange={(event) => setAbsenceForm((current) => ({ ...current, endTime: event.target.value }))}
                  />
                </div>
              </div>
            )}

            <div className="grid gap-2">
              <Label>Notes</Label>
              <Textarea
                placeholder="Optional details"
                value={absenceForm.notes}
                onChange={(event) => setAbsenceForm((current) => ({ ...current, notes: event.target.value }))}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAbsenceDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveAbsence}
              disabled={createAbsence.isPending || updateAbsence.isPending}
            >
              {editingAbsenceId ? "Save changes" : "Add absence"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
