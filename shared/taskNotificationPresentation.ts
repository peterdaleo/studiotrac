import { isTaskAssignmentNotification, taskNotificationHref } from "./taskNotifications";

export type PresentedNotification = {
  id: number;
  type: string;
  title: string;
  userId: number | null;
  organizationId: number | null;
  relatedTaskId: number | null;
  relatedProjectId: number | null;
  isRead: boolean;
};

function positiveId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function parseFocusedTaskId(search: string): number | null {
  const value = new URLSearchParams(search).get("taskId");
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return positiveId(id) ? id : null;
}

/** A task notice always goes to its task, even when it also links a project. */
export function notificationDestination(notice: {
  relatedTaskId?: number | null;
  relatedProjectId?: number | null;
}): string | null {
  if (positiveId(notice.relatedTaskId)) return taskNotificationHref(notice.relatedTaskId);
  if (positiveId(notice.relatedProjectId)) return `/projects/${notice.relatedProjectId}`;
  return null;
}

export type AssignmentToastState = { initialized: boolean; seenIds: number[] };

export function parseAssignmentToastState(value: string | null): AssignmentToastState {
  try {
    const parsed = value ? JSON.parse(value) : null;
    if (parsed?.initialized === true && Array.isArray(parsed.seenIds)) {
      return { initialized: true, seenIds: parsed.seenIds.filter(positiveId).slice(-1000) };
    }
  } catch {
    // Unavailable or stale browser storage must never prevent in-app notices.
  }
  return { initialized: false, seenIds: [] };
}

export function collectAssignmentToasts<T extends PresentedNotification>(
  notices: readonly T[],
  principal: { userId: number; organizationId: number },
  state: AssignmentToastState,
): { state: AssignmentToastState; fresh: T[] } {
  const seen = new Set(state.seenIds);
  const fresh: T[] = [];
  for (const notice of notices) {
    if (
      notice.userId !== principal.userId ||
      notice.organizationId !== principal.organizationId ||
      !isTaskAssignmentNotification(notice) ||
      !positiveId(notice.id)
    ) continue;
    if (state.initialized && !notice.isRead && !seen.has(notice.id)) fresh.push(notice);
    seen.add(notice.id);
  }
  // Initial load is a baseline, not a storm of toasts for historic unread items.
  return { state: { initialized: true, seenIds: Array.from(seen).slice(-1000) }, fresh };
}
