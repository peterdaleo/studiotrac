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
export type ProspectClosedStage = "Won" | "Lost";
export type ProspectInsightRecord = {
  stage: string;
  createdAt: Date | string;
  closedAt?: Date | string | null;
  referralSource?: string | null;
  ownerId?: number | null;
};
export type ProspectInsightOptions = { ownerId?: number | null; from?: string; to?: string };
export type ProspectOutcomeListMode = "all" | "dated" | "undated";
export type ProspectOutcomeListOptions = {
  mode?: ProspectOutcomeListMode;
  from?: string;
  to?: string;
};
export type ProspectReferralInsight = {
  source: string | null;
  label: string;
  wonCount: number;
  closedOutcomeCount: number;
  winRate: number;
};
export type ProspectInsights = {
  openByStage: Record<Exclude<ProspectStage, ProspectClosedStage>, number>;
  totalOpen: number;
  wonCount: number;
  lostCount: number;
  closedOutcomeCount: number;
  winRate: number | null;
  medianElapsedDays: number | null;
  undatedOutcomeCount: number;
  byReferralSource: ProspectReferralInsight[];
};

// Display grouping only: callers retain the full filtered list for CSV and print.
export function groupProspectsByConversion<T extends { convertedProjectId: number | null }>(prospects: T[]) {
  const working: T[] = [];
  const converted: T[] = [];
  for (const prospect of prospects) {
    (prospect.convertedProjectId != null ? converted : working).push(prospect);
  }
  return { working, converted };
}

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
  const date = validProspectDate(value);
  if (!date) return false;
  const key = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value
    : localDateKey(date);
  return (!from || key >= from) && (!to || key <= to);
}

/**
 * Open prospects are a current snapshot and ignore decision-date bounds. In the
 * default mode terminal prospects are all shown until a bound is set, at which
 * point only dated outcomes in range remain. Explicit dated/undated modes show
 * only the matching terminal records; undated records are never date-inferred.
 */
export function matchesProspectOutcomeList(
  record: ProspectInsightRecord,
  options: ProspectOutcomeListOptions = {},
): boolean {
  const isTerminal = record.stage === "Won" || record.stage === "Lost";
  const mode = options.mode ?? "all";
  if (!isTerminal) return mode === "all";

  const hasDecisionDate = validProspectDate(record.closedAt) !== null;
  if (mode === "undated") return !hasDecisionDate;
  if (!hasDecisionDate) return mode === "all" && !options.from && !options.to;
  if (mode === "dated" || options.from || options.to) {
    return prospectDateInRange(record.closedAt, options.from, options.to);
  }
  return true;
}

export function escapeCsvCell(value: unknown): string {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/** Returns a valid date value, rejecting invalid and impossible date-only strings. */
export function validProspectDate(value: Date | string | null | undefined): Date | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    const parsed = new Date(Number(year), Number(month) - 1, Number(day), 12);
    if (parsed.getFullYear() !== Number(year) || parsed.getMonth() !== Number(month) - 1 || parsed.getDate() !== Number(day)) return null;
    return parsed;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Missing referral sources share one bucket; populated values remain exact and case-sensitive. */
export function prospectReferralSourceKey(source: string | null | undefined): string | null {
  return source == null || source === "" ? null : source;
}

export function prospectReferralSourceLabel(source: string | null): string {
  return source === null ? "No referral source (missing)" : source;
}

/** New terminal records receive their actual creation/decision time, never a client-supplied date. */
export function initialProspectClosedAt(stage: string, now = new Date()): Date | null {
  return stage === "Won" || stage === "Lost" ? now : null;
}

/** Resolve a stage transition while the prospect row is locked. */
export function prospectClosedAtAfterStageChange(
  previousStage: string,
  previousClosedAt: Date | null,
  nextStage: string,
  now = new Date(),
): Date | null {
  const wasClosed = previousStage === "Won" || previousStage === "Lost";
  const isClosed = nextStage === "Won" || nextStage === "Lost";
  if (!wasClosed && isClosed) return now;
  if (wasClosed && !isClosed) return null;
  if (wasClosed && isClosed && previousStage !== nextStage) return now;
  return previousClosedAt;
}

/** Open counts ignore date bounds. Closed outcomes use current owner and inclusive decision-date bounds. */
export function computeProspectInsights<T extends ProspectInsightRecord>(
  records: readonly T[],
  options: ProspectInsightOptions = {},
): ProspectInsights {
  const openByStage: ProspectInsights["openByStage"] = {
    New: 0,
    Contacted: 0,
    Proposal: 0,
    Negotiation: 0,
  };
  const currentOwnerRecords = records.filter((record) => options.ownerId === undefined || (record.ownerId ?? null) === options.ownerId);
  const undatedOutcomeCount = currentOwnerRecords.filter((record) =>
    (record.stage === "Won" || record.stage === "Lost") && !validProspectDate(record.closedAt),
  ).length;
  const datedOutcomes = currentOwnerRecords.filter((record) => {
    if (record.stage !== "Won" && record.stage !== "Lost") return false;
    return validProspectDate(record.closedAt) !== null && prospectDateInRange(record.closedAt, options.from, options.to);
  });
  for (const record of currentOwnerRecords) {
    if (record.stage in openByStage) openByStage[record.stage as keyof typeof openByStage] += 1;
  }
  const wonCount = datedOutcomes.filter((record) => record.stage === "Won").length;
  const lostCount = datedOutcomes.filter((record) => record.stage === "Lost").length;
  const durations = datedOutcomes.flatMap((record) => {
    const createdAt = validProspectDate(record.createdAt);
    const closedAt = validProspectDate(record.closedAt);
    if (!createdAt || !closedAt) return [];
    const elapsed = (closedAt.getTime() - createdAt.getTime()) / 86_400_000;
    return Number.isFinite(elapsed) && elapsed >= 0 ? [elapsed] : [];
  }).sort((left, right) => left - right);
  const middle = Math.floor(durations.length / 2);
  const medianElapsedDays = durations.length === 0
    ? null
    : durations.length % 2 === 1
      ? durations[middle]
      : (durations[middle - 1] + durations[middle]) / 2;
  const grouped = new Map<string | null, { wonCount: number; closedOutcomeCount: number }>();
  for (const record of datedOutcomes) {
    const source = prospectReferralSourceKey(record.referralSource);
    const bucket = grouped.get(source) ?? { wonCount: 0, closedOutcomeCount: 0 };
    bucket.closedOutcomeCount += 1;
    if (record.stage === "Won") bucket.wonCount += 1;
    grouped.set(source, bucket);
  }
  const byReferralSource = Array.from(grouped.entries())
    .map(([source, bucket]) => ({
      source,
      label: prospectReferralSourceLabel(source),
      ...bucket,
      winRate: bucket.wonCount / bucket.closedOutcomeCount,
    }))
    .sort((left, right) => right.closedOutcomeCount - left.closedOutcomeCount || left.label.localeCompare(right.label));
  const closedOutcomeCount = wonCount + lostCount;
  return {
    openByStage,
    totalOpen: Object.values(openByStage).reduce((sum, count) => sum + count, 0),
    wonCount,
    lostCount,
    closedOutcomeCount,
    winRate: closedOutcomeCount ? wonCount / closedOutcomeCount : null,
    medianElapsedDays,
    undatedOutcomeCount,
    byReferralSource,
  };
}
