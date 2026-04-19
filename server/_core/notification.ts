// Notification stub — Manus Forge notification service removed for standalone deployment.
// Replace with your own email/Slack integration as needed.

export type NotificationPayload = {
  title: string;
  content: string;
};

/**
 * Stub: logs the notification to console instead of sending to Manus.
 * Returns true to keep callers happy.
 */
export async function notifyOwner(
  payload: NotificationPayload
): Promise<boolean> {
  console.log(`[Notification] ${payload.title}: ${payload.content}`);
  return true;
}
