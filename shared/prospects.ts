export const PROSPECT_STAGES = [
  "New",
  "Contacted",
  "Proposal",
  "Negotiation",
  "Won",
  "Lost",
] as const;

export type ProspectStage = (typeof PROSPECT_STAGES)[number];
export type FollowUpStatus = "overdue" | "today" | "upcoming" | "none" | "closed";

export function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function defaultLastInteractionDate(value?: string | null, now = new Date()): string {
  return value || localDateKey(now);
}

export function getFollowUpStatus(
  followUpDate: string | null | undefined,
  stage: string,
  now = new Date(),
): FollowUpStatus {
  if (stage === "Won" || stage === "Lost") return "closed";
  if (!followUpDate) return "none";

  const dueDate = followUpDate.slice(0, 10);
  const today = localDateKey(now);
  if (dueDate < today) return "overdue";
  if (dueDate === today) return "today";
  return "upcoming";
}

export function prospectDateInRange(
  value: string | Date | null | undefined,
  from?: string,
  to?: string,
): boolean {
  if (!from && !to) return true;
  if (!value) return false;
  const key = typeof value === "string" ? value.slice(0, 10) : localDateKey(value);
  return (!from || key >= from) && (!to || key <= to);
}

export function escapeCsvCell(value: unknown): string {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
