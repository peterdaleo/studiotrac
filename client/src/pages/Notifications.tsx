import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Bell,
  BellOff,
  CheckCheck,
  Clock,
  AlertTriangle,
  ArrowRight,
  Info,
  FolderKanban,
} from "lucide-react";
import { useLocation } from "wouter";
import { toast } from "sonner";

const typeIcons: Record<string, React.ReactNode> = {
  deadline_approaching: <Clock className="h-4 w-4 text-amber-500" />,
  task_overdue: <AlertTriangle className="h-4 w-4 text-red-500" />,
  status_change: <FolderKanban className="h-4 w-4 text-primary" />,
  general: <Info className="h-4 w-4 text-muted-foreground" />,
};

const typeBg: Record<string, string> = {
  deadline_approaching: "bg-amber-50 border-amber-100",
  task_overdue: "bg-red-50 border-red-100",
  status_change: "bg-primary/5 border-primary/10",
  general: "bg-muted/50 border-muted",
};

export default function Notifications() {
  const [, setLocation] = useLocation();
  const { data: notifications, isLoading } = trpc.notifications.list.useQuery();
  const { data: unreadCount } = trpc.notifications.unreadCount.useQuery();
  const utils = trpc.useUtils();

  const markRead = trpc.notifications.markRead.useMutation({
    onSuccess: () => {
      utils.notifications.list.invalidate();
      utils.notifications.unreadCount.invalidate();
    },
  });

  const markAllRead = trpc.notifications.markAllRead.useMutation({
    onSuccess: () => {
      utils.notifications.list.invalidate();
      utils.notifications.unreadCount.invalidate();
      toast.success("All notifications marked as read");
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Notifications</h1>
          <p className="text-muted-foreground mt-1">
            {(unreadCount ?? 0) > 0 ? `${unreadCount} unread` : "All caught up"}
          </p>
        </div>
        {(unreadCount ?? 0) > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => markAllRead.mutate()}
            disabled={markAllRead.isPending}
          >
            <CheckCheck className="h-4 w-4 mr-2" />
            Mark all read
          </Button>
        )}
      </div>

      {!notifications || notifications.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20">
          <BellOff className="h-12 w-12 text-muted-foreground/30 mb-4" />
          <h3 className="text-lg font-medium">No notifications</h3>
          <p className="text-sm text-muted-foreground mt-1">
            You're all caught up. Notifications about deadlines and tasks will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {notifications.map((notif) => (
            <Card
              key={notif.id}
              className={`border shadow-sm transition-all cursor-pointer hover:shadow-md ${
                !notif.isRead ? typeBg[notif.type] ?? "" : "opacity-70"
              }`}
              onClick={() => {
                if (!notif.isRead) markRead.mutate({ id: notif.id });
                if (notif.relatedProjectId) setLocation(`/projects/${notif.relatedProjectId}`);
              }}
            >
              <CardContent className="p-4 flex items-start gap-3">
                <div className="mt-0.5 shrink-0">
                  {typeIcons[notif.type] ?? typeIcons.general}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className={`text-sm font-medium ${!notif.isRead ? "" : "text-muted-foreground"}`}>
                      {notif.title}
                    </p>
                    {!notif.isRead && (
                      <div className="h-2 w-2 rounded-full bg-primary shrink-0" />
                    )}
                  </div>
                  {notif.message && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{notif.message}</p>
                  )}
                  <p className="text-[10px] text-muted-foreground mt-2">
                    {new Date(notif.createdAt).toLocaleString()}
                  </p>
                </div>
                {notif.relatedProjectId && (
                  <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
