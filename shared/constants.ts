// Architecture-specific project phases
export const PROJECT_PHASES = [
  { value: "pre_design", label: "Pre-Design", shortLabel: "PD", order: 0 },
  { value: "schematic_design", label: "Schematic Design", shortLabel: "SD", order: 1 },
  { value: "design_development", label: "Design Development", shortLabel: "DD", order: 2 },
  { value: "construction_documents", label: "Construction Documents", shortLabel: "CD", order: 3 },
  { value: "bidding_negotiation", label: "Bidding & Negotiation", shortLabel: "BN", order: 4 },
  { value: "construction_administration", label: "Construction Administration", shortLabel: "CA", order: 5 },
  { value: "post_occupancy", label: "Post-Occupancy", shortLabel: "PO", order: 6 },
] as const;

export const PROJECT_STATUSES = [
  { value: "on_track", label: "On Track", color: "success" },
  { value: "on_hold", label: "On Hold", color: "warning" },
  { value: "delayed", label: "Delayed", color: "destructive" },
  { value: "completed", label: "Completed", color: "muted" },
] as const;

// Selectable statuses — "overdue" is NOT a selectable status; it is computed
export const TASK_STATUSES = [
  { value: "todo", label: "To Do" },
  { value: "in_progress", label: "In Progress" },
  { value: "done", label: "Done" },
] as const;

// Filter options include the computed "overdue" pseudo-status for filtering
export const TASK_STATUS_FILTERS = [
  { value: "todo", label: "To Do" },
  { value: "in_progress", label: "In Progress" },
  { value: "done", label: "Done" },
  { value: "overdue", label: "Overdue" },
] as const;

export type ProjectPhase = (typeof PROJECT_PHASES)[number]["value"];
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]["value"];
export type TaskStatus = "todo" | "in_progress" | "done" | "overdue";

/** Returns true if a task is overdue: not done and deadline is in the past */
export function isTaskOverdue(status: string, deadline: Date | string | null | undefined): boolean {
  if (status === "done") return false;
  if (!deadline) return false;
  return new Date(deadline) < new Date();
}

export function getPhaseLabel(phase: string): string {
  return PROJECT_PHASES.find((p) => p.value === phase)?.label ?? phase;
}

export function getPhaseShortLabel(phase: string): string {
  return PROJECT_PHASES.find((p) => p.value === phase)?.shortLabel ?? phase;
}

export function getStatusLabel(status: string): string {
  return PROJECT_STATUSES.find((s) => s.value === status)?.label ?? status;
}

export function getStatusColor(status: string): string {
  return PROJECT_STATUSES.find((s) => s.value === status)?.color ?? "muted";
}
