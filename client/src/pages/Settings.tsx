import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Bell,
  Mail,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Send,
  Settings as SettingsIcon,
  Shield,
  Loader2,
  DollarSign,
  Plus,
  X,
} from "lucide-react";
import { toast } from "sonner";

export default function Settings() {
  const { user } = useAuth();
  const utils = trpc.useUtils();

  const { data: emailPrefs, isLoading: prefsLoading } = trpc.emailPreferences.get.useQuery();
  const { data: emailLog } = trpc.emailNotifications.log.useQuery();
  const { data: billingEmails, isLoading: billingEmailsLoading } = trpc.billingEmails.list.useQuery();

  const upsertPrefs = trpc.emailPreferences.upsert.useMutation({
    onSuccess: () => {
      utils.emailPreferences.get.invalidate();
      toast.success("Notification preferences saved");
    },
    onError: (err) => toast.error(err.message),
  });

  const checkDeadlines = trpc.emailNotifications.checkDeadlines.useMutation({
    onSuccess: (result) => {
      utils.emailNotifications.log.invalidate();
      utils.notifications.list.invalidate();
      utils.notifications.unreadCount.invalidate();
      if (result.alertsGenerated > 0) {
        toast.success(`Generated ${result.alertsGenerated} deadline alert(s)`);
      } else {
        toast.info("No upcoming deadlines or overdue tasks found");
      }
    },
    onError: (err) => toast.error(err.message),
  });

  const addBillingEmail = trpc.billingEmails.add.useMutation({
    onSuccess: () => {
      utils.billingEmails.list.invalidate();
      setNewBillingEmail("");
      toast.success("Billing email added");
    },
    onError: (err) => toast.error(err.message),
  });

  const removeBillingEmail = trpc.billingEmails.remove.useMutation({
    onSuccess: () => {
      utils.billingEmails.list.invalidate();
      toast.success("Billing email removed");
    },
    onError: (err) => toast.error(err.message),
  });

  const [emailAddress, setEmailAddress] = useState("");
  const [deadlineAlerts, setDeadlineAlerts] = useState(true);
  const [overdueAlerts, setOverdueAlerts] = useState(true);
  const [statusChangeAlerts, setStatusChangeAlerts] = useState(true);
  const [alertDaysBefore, setAlertDaysBefore] = useState("3");
  const [newBillingEmail, setNewBillingEmail] = useState("");

  useEffect(() => {
    if (emailPrefs) {
      setEmailAddress(emailPrefs.emailAddress || "");
      setDeadlineAlerts(emailPrefs.deadlineAlerts);
      setOverdueAlerts(emailPrefs.overdueAlerts);
      setStatusChangeAlerts(emailPrefs.statusChangeAlerts);
      setAlertDaysBefore(String(emailPrefs.alertDaysBefore));
    }
  }, [emailPrefs]);

  const handleSavePrefs = () => {
    if (!emailAddress.trim()) {
      toast.error("Please enter an email address");
      return;
    }
    upsertPrefs.mutate({
      emailAddress: emailAddress.trim(),
      deadlineAlerts,
      overdueAlerts,
      statusChangeAlerts,
      alertDaysBefore: Number(alertDaysBefore),
    });
  };

  const handleAddBillingEmail = () => {
    const trimmed = newBillingEmail.trim();
    if (!trimmed) {
      toast.error("Please enter an email address");
      return;
    }
    // Basic email validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      toast.error("Please enter a valid email address");
      return;
    }
    addBillingEmail.mutate({ emailAddress: trimmed });
  };

  if (prefsLoading) {
    return (
      <div className="space-y-6 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6 max-w-3xl">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <SettingsIcon className="h-7 w-7" />
          Settings
        </h1>
        <p className="text-muted-foreground mt-1">Manage notification preferences and alert configuration</p>
      </div>

      {/* Billing Department Emails */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5" />
            Billing Department Emails
          </CardTitle>
          <CardDescription>
            Configure email addresses for the billing department. When a project reaches a billing
            milestone (25%, 50%, 75%, 100%), notifications will be sent automatically to these addresses.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Current billing emails */}
          {billingEmailsLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : billingEmails && billingEmails.length > 0 ? (
            <div className="space-y-2">
              {billingEmails.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border"
                >
                  <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">{entry.emailAddress}</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                    onClick={() => removeBillingEmail.mutate({ id: entry.id })}
                    disabled={removeBillingEmail.isPending}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">
              No billing department emails configured. Add one below to receive milestone notifications.
            </p>
          )}

          <Separator />

          {/* Add new billing email */}
          <div className="space-y-2">
            <Label htmlFor="billingEmail">Add Email Address</Label>
            <div className="flex items-center gap-2">
              <Input
                id="billingEmail"
                type="email"
                placeholder="billing@yourfirm.com"
                value={newBillingEmail}
                onChange={(e) => setNewBillingEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddBillingEmail();
                  }
                }}
              />
              <Button
                onClick={handleAddBillingEmail}
                disabled={addBillingEmail.isPending}
                size="sm"
              >
                {addBillingEmail.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              All listed addresses will receive billing milestone notifications when projects reach 25%, 50%, 75%, or 100% completion.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Email Notification Preferences */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Email Notifications
          </CardTitle>
          <CardDescription>
            Configure email alerts for approaching deadlines, overdue tasks, and project status changes.
            Alerts are generated as in-app notifications and logged for review.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Email Address */}
          <div className="space-y-2">
            <Label htmlFor="email">Notification Email Address</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@studio.com"
              value={emailAddress}
              onChange={(e) => setEmailAddress(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Alerts will be sent to this address and logged in the notification center.
            </p>
          </div>

          <Separator />

          {/* Alert Types */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold">Alert Types</h3>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg bg-amber-100 flex items-center justify-center">
                  <Clock className="h-4 w-4 text-amber-600" />
                </div>
                <div>
                  <p className="text-sm font-medium">Deadline Approaching</p>
                  <p className="text-xs text-muted-foreground">Get notified before task and project deadlines</p>
                </div>
              </div>
              <Switch checked={deadlineAlerts} onCheckedChange={setDeadlineAlerts} />
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg bg-red-100 flex items-center justify-center">
                  <AlertTriangle className="h-4 w-4 text-red-600" />
                </div>
                <div>
                  <p className="text-sm font-medium">Overdue Tasks</p>
                  <p className="text-xs text-muted-foreground">Alert when tasks pass their deadline without completion</p>
                </div>
              </div>
              <Switch checked={overdueAlerts} onCheckedChange={setOverdueAlerts} />
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg bg-blue-100 flex items-center justify-center">
                  <Bell className="h-4 w-4 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm font-medium">Status Changes</p>
                  <p className="text-xs text-muted-foreground">Notify when project status changes (On Track, Delayed, etc.)</p>
                </div>
              </div>
              <Switch checked={statusChangeAlerts} onCheckedChange={setStatusChangeAlerts} />
            </div>
          </div>

          <Separator />

          {/* Alert Timing */}
          <div className="space-y-2">
            <Label>Alert Timing</Label>
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">Notify me</span>
              <Select value={alertDaysBefore} onValueChange={setAlertDaysBefore}>
                <SelectTrigger className="w-[100px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 day</SelectItem>
                  <SelectItem value="2">2 days</SelectItem>
                  <SelectItem value="3">3 days</SelectItem>
                  <SelectItem value="5">5 days</SelectItem>
                  <SelectItem value="7">7 days</SelectItem>
                  <SelectItem value="14">14 days</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-sm text-muted-foreground">before deadline</span>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <Button onClick={handleSavePrefs} disabled={upsertPrefs.isPending}>
              {upsertPrefs.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <CheckCircle2 className="h-4 w-4 mr-2" />
              )}
              Save Preferences
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Manual Deadline Check */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Send className="h-5 w-5" />
            Deadline Check
          </CardTitle>
          <CardDescription>
            Manually scan all projects and tasks for approaching deadlines and overdue items.
            This generates in-app notifications and logs alerts.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            onClick={() => checkDeadlines.mutate()}
            disabled={checkDeadlines.isPending}
          >
            {checkDeadlines.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Bell className="h-4 w-4 mr-2" />
            )}
            Run Deadline Check Now
          </Button>

          {checkDeadlines.data && (
            <div className="mt-4 p-4 rounded-lg bg-muted/50">
              <p className="text-sm font-medium mb-2">
                Last check: {checkDeadlines.data.alertsGenerated} alert(s) generated
              </p>
              {checkDeadlines.data.alerts.length > 0 && (
                <div className="space-y-1.5">
                  {checkDeadlines.data.alerts.slice(0, 10).map((alert, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      {alert.type.includes("overdue") ? (
                        <AlertTriangle className="h-3 w-3 text-red-500 shrink-0" />
                      ) : (
                        <Clock className="h-3 w-3 text-amber-500 shrink-0" />
                      )}
                      <span>{alert.title}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Email Log */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Notification Log
          </CardTitle>
          <CardDescription>
            Recent notification alerts generated by the system
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!emailLog || emailLog.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              No notifications logged yet. Run a deadline check to generate alerts.
            </p>
          ) : (
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {emailLog.map((entry) => (
                <div key={entry.id} className="flex items-start gap-3 p-3 rounded-lg bg-muted/30 text-sm">
                  <Mail className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{entry.subject}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{entry.body}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(entry.sentAt).toLocaleString()}
                      </span>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        logged
                      </Badge>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
