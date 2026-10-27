export const TASK_ASSIGNMENT_NOTIFICATION_TITLE = "Task assigned to you";

export type TaskAssignmentNotificationLike = {
  type?: unknown;
  title?: unknown;
  relatedTaskId?: unknown;
  userId?: unknown;
} | null | undefined;

/** Identifies only user-specific task-assignment notices, not other general notices. */
export function isTaskAssignmentNotification(notice: TaskAssignmentNotificationLike): boolean {
  return Boolean(
    notice &&
      notice.type === "general" &&
      notice.title === TASK_ASSIGNMENT_NOTIFICATION_TITLE &&
      Number.isInteger(notice.relatedTaskId) &&
      Number(notice.relatedTaskId) > 0 &&
      Number.isInteger(notice.userId) &&
      Number(notice.userId) > 0,
  );
}

export function taskNotificationHref(taskId: number): string {
  if (!Number.isSafeInteger(taskId) || taskId <= 0) {
    throw new TypeError("taskId must be a positive safe integer");
  }
  return `/tasks?taskId=${taskId}`;
}
