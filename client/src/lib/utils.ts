import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a date-only field (stored as UTC midnight) for display.
 * Uses UTC date parts to avoid off-by-one errors for users west of UTC.
 */
export function formatDateUTC(d: Date | string | null | undefined): string {
  if (!d) return "";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "";
  return `${dt.getUTCMonth() + 1}/${dt.getUTCDate()}/${dt.getUTCFullYear()}`;
}

/**
 * Returns the number of calendar days from today until the given deadline.
 * Uses UTC date parts so the result is timezone-independent.
 * Returns 0 for "due today", negative for overdue.
 */
export function daysUntilUTC(d: Date | string | null | undefined): number | null {
  if (!d) return null;
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return null;
  const now = new Date();
  const deadlineDay = Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate());
  const todayDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((deadlineDay - todayDay) / 86400000);
}

/**
 * Returns true if the deadline date (stored as UTC midnight) is strictly before today.
 * Uses UTC date parts so the result is timezone-independent.
 */
export function isDeadlineOverdueUTC(d: Date | string | null | undefined): boolean {
  const days = daysUntilUTC(d);
  return days !== null && days < 0;
}

/**
 * Check if two dates represent the same calendar day, where `eventDate` is a
 * UTC-midnight date (from the server) and `calDay` is a local-midnight Date
 * (from the calendar grid). Compares event's UTC date parts against calDay's
 * local date parts — correct for all timezones.
 */
export function isSameDayUTCvsLocal(eventDate: Date, calDay: Date): boolean {
  return (
    eventDate.getUTCFullYear() === calDay.getFullYear() &&
    eventDate.getUTCMonth() === calDay.getMonth() &&
    eventDate.getUTCDate() === calDay.getDate()
  );
}
