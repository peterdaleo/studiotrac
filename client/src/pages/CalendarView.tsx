import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  Clock,
  FolderKanban,
  CheckSquare,
} from "lucide-react";
import { useLocation } from "wouter";
import { getStatusLabel } from "@shared/constants";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

interface CalendarEvent {
  id: string;
  title: string;
  date: Date;
  type: "project_deadline" | "task_deadline";
  projectId?: number;
  status?: string;
  isOverdue?: boolean;
}

export default function CalendarView() {
  const [, setLocation] = useLocation();
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  const { data: projects, isLoading: projectsLoading } = trpc.projects.list.useQuery({});
  const { data: tasks, isLoading: tasksLoading } = trpc.tasks.list.useQuery({});

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const events = useMemo(() => {
    const evts: CalendarEvent[] = [];
    projects?.forEach((p) => {
      if (p.deadline) {
        evts.push({
          id: `project-${p.id}`,
          title: p.name,
          date: new Date(p.deadline),
          type: "project_deadline",
          projectId: p.id,
          status: p.status,
          isOverdue: new Date(p.deadline) < new Date() && p.status !== "completed",
        });
      }
    });
    tasks?.forEach((t) => {
      if (t.deadline && t.status !== "done") {
        evts.push({
          id: `task-${t.id}`,
          title: t.title,
          date: new Date(t.deadline),
          type: "task_deadline",
          projectId: t.projectId,
          isOverdue: new Date(t.deadline) < new Date(),
        });
      }
    });
    return evts;
  }, [projects, tasks]);

  const calendarDays = useMemo(() => {
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startPad = firstDay.getDay();
    const days: { date: Date; isCurrentMonth: boolean }[] = [];

    // Previous month padding
    for (let i = startPad - 1; i >= 0; i--) {
      days.push({
        date: new Date(year, month, -i),
        isCurrentMonth: false,
      });
    }
    // Current month
    for (let d = 1; d <= lastDay.getDate(); d++) {
      days.push({ date: new Date(year, month, d), isCurrentMonth: true });
    }
    // Next month padding
    const remaining = 42 - days.length;
    for (let i = 1; i <= remaining; i++) {
      days.push({
        date: new Date(year, month + 1, i),
        isCurrentMonth: false,
      });
    }
    return days;
  }, [year, month]);

  const getEventsForDate = (date: Date) => {
    return events.filter(
      (e) =>
        e.date.getFullYear() === date.getFullYear() &&
        e.date.getMonth() === date.getMonth() &&
        e.date.getDate() === date.getDate()
    );
  };

  const selectedEvents = selectedDate ? getEventsForDate(selectedDate) : [];

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));
  const goToday = () => {
    setCurrentDate(new Date());
    setSelectedDate(new Date());
  };

  const isToday = (date: Date) => {
    const today = new Date();
    return (
      date.getFullYear() === today.getFullYear() &&
      date.getMonth() === today.getMonth() &&
      date.getDate() === today.getDate()
    );
  };

  const isSelected = (date: Date) => {
    if (!selectedDate) return false;
    return (
      date.getFullYear() === selectedDate.getFullYear() &&
      date.getMonth() === selectedDate.getMonth() &&
      date.getDate() === selectedDate.getDate()
    );
  };

  if (projectsLoading || tasksLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-[500px] rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Calendar</h1>
        <p className="text-muted-foreground mt-1">
          Project deadlines and task milestones
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Calendar */}
        <Card className="border-0 shadow-sm lg:col-span-3">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
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
            {/* Day Headers */}
            <div className="grid grid-cols-7 mb-2">
              {DAYS.map((day) => (
                <div key={day} className="text-center text-xs font-medium text-muted-foreground py-2">
                  {day}
                </div>
              ))}
            </div>
            {/* Calendar Grid */}
            <div className="grid grid-cols-7 gap-px bg-border rounded-lg overflow-hidden">
              {calendarDays.map((day, i) => {
                const dayEvents = getEventsForDate(day.date);
                const hasProjectDeadline = dayEvents.some((e) => e.type === "project_deadline");
                const hasOverdue = dayEvents.some((e) => e.isOverdue);
                return (
                  <button
                    key={i}
                    onClick={() => setSelectedDate(day.date)}
                    className={`min-h-[80px] p-1.5 text-left transition-colors bg-card hover:bg-muted/50 ${
                      !day.isCurrentMonth ? "opacity-40" : ""
                    } ${isSelected(day.date) ? "ring-2 ring-primary ring-inset" : ""}`}
                  >
                    <span
                      className={`text-xs font-medium inline-flex h-6 w-6 items-center justify-center rounded-full ${
                        isToday(day.date)
                          ? "bg-primary text-primary-foreground"
                          : ""
                      }`}
                    >
                      {day.date.getDate()}
                    </span>
                    <div className="mt-0.5 space-y-0.5">
                      {dayEvents.slice(0, 2).map((evt) => (
                        <div
                          key={evt.id}
                          className={`text-[9px] leading-tight px-1 py-0.5 rounded truncate ${
                            evt.isOverdue
                              ? "bg-red-100 text-red-700"
                              : evt.type === "project_deadline"
                              ? "bg-primary/10 text-primary"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {evt.title}
                        </div>
                      ))}
                      {dayEvents.length > 2 && (
                        <div className="text-[9px] text-muted-foreground px-1">
                          +{dayEvents.length - 2} more
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Selected Day Details */}
        <div className="space-y-4">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">
                {selectedDate
                  ? selectedDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
                  : "Select a date"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!selectedDate ? (
                <p className="text-sm text-muted-foreground">Click a date to see events</p>
              ) : selectedEvents.length === 0 ? (
                <p className="text-sm text-muted-foreground">No events on this date</p>
              ) : (
                <div className="space-y-3">
                  {selectedEvents.map((evt) => (
                    <button
                      key={evt.id}
                      onClick={() => evt.projectId && setLocation(`/projects/${evt.projectId}`)}
                      className="w-full text-left p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        {evt.type === "project_deadline" ? (
                          <FolderKanban className="h-3.5 w-3.5 text-primary" />
                        ) : (
                          <CheckSquare className="h-3.5 w-3.5 text-muted-foreground" />
                        )}
                        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          {evt.type === "project_deadline" ? "Project Deadline" : "Task Due"}
                        </span>
                        {evt.isOverdue && (
                          <Badge variant="destructive" className="text-[9px] h-4 px-1">Overdue</Badge>
                        )}
                      </div>
                      <p className="text-sm font-medium">{evt.title}</p>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Legend */}
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 space-y-2">
              <p className="text-xs font-medium text-muted-foreground mb-2">Legend</p>
              <div className="flex items-center gap-2">
                <div className="h-2.5 w-2.5 rounded-sm bg-primary/30" />
                <span className="text-xs">Project Deadline</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-2.5 w-2.5 rounded-sm bg-muted" />
                <span className="text-xs">Task Due Date</span>
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
  );
}
