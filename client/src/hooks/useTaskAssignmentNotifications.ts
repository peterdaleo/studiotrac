import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import {
  collectAssignmentToasts,
  notificationDestination,
  parseAssignmentToastState,
  type AssignmentToastState,
} from "@shared/taskNotificationPresentation";

type Principal = { id: number; organizationId: number | null };

/** Polling is deliberately in-app only: no email, SMS, push, or read-on-delivery. */
export function useTaskAssignmentNotifications(
  user: Principal | null | undefined,
  navigate: (path: string) => void,
) {
  const utils = trpc.useUtils();
  const { data, isSuccess } = trpc.notifications.list.useQuery(undefined, {
    enabled: !!user?.id && !!user.organizationId,
    refetchInterval: 10000,
  });
  const { mutate: markRead } = trpc.notifications.markRead.useMutation({
    onSuccess: () => {
      void utils.notifications.list.invalidate();
      void utils.notifications.unreadCount.invalidate();
    },
  });
  const remembered = useRef<{ key: string; state: AssignmentToastState } | null>(null);

  useEffect(() => {
    if (!isSuccess || !data || !user?.id || !user.organizationId) return;
    const key = `task-assignment-toasts:${user.organizationId}:${user.id}`;
    if (remembered.current?.key !== key) {
      let stored: string | null = null;
      try { stored = sessionStorage.getItem(key); } catch { /* Storage can be disabled. */ }
      remembered.current = { key, state: parseAssignmentToastState(stored) };
    }
    const result = collectAssignmentToasts(data, {
      userId: user.id,
      organizationId: user.organizationId,
    }, remembered.current.state);
    remembered.current.state = result.state;
    try { sessionStorage.setItem(key, JSON.stringify(result.state)); } catch { /* In-memory dedupe remains. */ }
    if (result.fresh.length === 1) {
      const notice = result.fresh[0];
      toast.info(notice.title, {
        id: `task-assignment:${user.id}:${notice.id}`,
        description: notice.message || undefined,
        duration: 5000,
        action: {
          label: "View task",
          onClick: () => {
            markRead({ id: notice.id });
            const destination = notificationDestination(notice);
            if (destination) navigate(destination);
          },
        },
      });
    } else if (result.fresh.length > 1) {
      toast.info(`${result.fresh.length} new task assignments`, {
        id: `task-assignments:${user.id}:${result.fresh.map((notice) => notice.id).join("-")}`,
        description: "Your unread assignments are in Notifications.",
        duration: 5000,
        action: { label: "View notifications", onClick: () => navigate("/notifications") },
      });
    }
  }, [data, isSuccess, user?.id, user?.organizationId, markRead, navigate]);
}
