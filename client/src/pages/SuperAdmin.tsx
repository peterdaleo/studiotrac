import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Building2,
  Users,
  CreditCard,
  DollarSign,
  Eye,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

function formatDate(date: Date | string) {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, string> = {
    active: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    canceled: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    past_due: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    trialing: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    none: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${variants[status] ?? variants.none}`}>
      {status === "none" ? "No plan" : status.replace("_", " ")}
    </span>
  );
}

export default function SuperAdmin() {
  const utils = trpc.useUtils();
  const { data: metrics, isLoading: metricsLoading } = trpc.superAdmin.metrics.useQuery();
  const { data: firms, isLoading: firmsLoading } = trpc.superAdmin.firms.useQuery();

  const [selectedFirmId, setSelectedFirmId] = useState<number | null>(null);
  const [cancelOrgId, setCancelOrgId] = useState<number | null>(null);

  const { data: firmDetail, isLoading: detailLoading } = trpc.superAdmin.firmDetail.useQuery(
    { id: selectedFirmId! },
    { enabled: selectedFirmId !== null }
  );

  const cancelSub = trpc.superAdmin.cancelSubscription.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success(data.message);
        utils.superAdmin.firms.invalidate();
        utils.superAdmin.metrics.invalidate();
      } else {
        toast.error(data.message);
      }
      setCancelOrgId(null);
    },
    onError: (err) => {
      toast.error(err.message);
      setCancelOrgId(null);
    },
  });

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Platform Admin</h1>
        <p className="text-muted-foreground mt-1">
          Overview of all firms, users, and subscriptions on StudioTrac.
        </p>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Total Firms"
          value={metrics?.totalFirms}
          icon={<Building2 className="h-4 w-4" />}
          loading={metricsLoading}
        />
        <MetricCard
          title="Total Users"
          value={metrics?.totalUsers}
          icon={<Users className="h-4 w-4" />}
          loading={metricsLoading}
        />
        <MetricCard
          title="Active Subscriptions"
          value={metrics?.activeSubscriptions}
          icon={<CreditCard className="h-4 w-4" />}
          loading={metricsLoading}
        />
        <MetricCard
          title="Monthly Recurring Revenue"
          value={metrics?.mrr !== undefined ? `$${metrics.mrr.toLocaleString()}` : undefined}
          icon={<DollarSign className="h-4 w-4" />}
          loading={metricsLoading}
        />
      </div>

      {/* Firms Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">All Firms</CardTitle>
        </CardHeader>
        <CardContent>
          {firmsLoading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : !firms?.length ? (
            <p className="text-muted-foreground text-sm py-8 text-center">No firms registered yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-3 pr-4 font-medium">Firm</th>
                    <th className="pb-3 pr-4 font-medium">Users</th>
                    <th className="pb-3 pr-4 font-medium">Plan</th>
                    <th className="pb-3 pr-4 font-medium">Status</th>
                    <th className="pb-3 pr-4 font-medium">Signed Up</th>
                    <th className="pb-3 pr-4 font-medium">Last Active</th>
                    <th className="pb-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {firms.map((firm) => (
                    <tr key={firm.id} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                      <td className="py-3 pr-4">
                        <div className="font-medium">{firm.name}</div>
                        <div className="text-xs text-muted-foreground">{firm.slug}</div>
                      </td>
                      <td className="py-3 pr-4">{firm.userCount}</td>
                      <td className="py-3 pr-4">
                        <Badge variant={firm.planTier === "none" ? "outline" : "secondary"}>
                          {firm.planTier}
                        </Badge>
                      </td>
                      <td className="py-3 pr-4">
                        <StatusBadge status={firm.subscriptionStatus} />
                      </td>
                      <td className="py-3 pr-4 text-muted-foreground">
                        {formatDate(firm.createdAt)}
                      </td>
                      <td className="py-3 pr-4 text-muted-foreground">
                        {formatDate(firm.lastActive)}
                      </td>
                      <td className="py-3">
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setSelectedFirmId(firm.id)}
                            title="View details"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          {firm.subscriptionStatus === "active" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              onClick={() => setCancelOrgId(firm.id)}
                              title="Cancel subscription"
                            >
                              <XCircle className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Firm Detail Dialog */}
      <Dialog open={selectedFirmId !== null} onOpenChange={(open) => !open && setSelectedFirmId(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{firmDetail?.name ?? "Firm Details"}</DialogTitle>
          </DialogHeader>
          {detailLoading ? (
            <div className="space-y-3 py-4">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-5 w-60" />
              <Skeleton className="h-5 w-48" />
            </div>
          ) : firmDetail ? (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground">Slug:</span>{" "}
                  <span className="font-medium">{firmDetail.slug}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Created:</span>{" "}
                  <span className="font-medium">{formatDate(firmDetail.createdAt)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Team Members:</span>{" "}
                  <span className="font-medium">{firmDetail.teamMemberCount}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Onboarding:</span>{" "}
                  <Badge variant={firmDetail.onboardingCompleted ? "default" : "outline"}>
                    {firmDetail.onboardingCompleted ? "Completed" : "Pending"}
                  </Badge>
                </div>
              </div>

              {firmDetail.users.length > 0 && (
                <div>
                  <h4 className="font-medium text-sm mb-2">Users ({firmDetail.users.length})</h4>
                  <div className="border rounded-lg divide-y max-h-60 overflow-y-auto">
                    {firmDetail.users.map((u) => (
                      <div key={u.id} className="flex items-center justify-between px-3 py-2 text-sm">
                        <div>
                          <span className="font-medium">{u.name}</span>
                          <span className="text-muted-foreground ml-2">{u.email}</span>
                        </div>
                        <Badge variant="outline" className="text-xs">
                          {u.orgRole}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground py-4">Firm not found.</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedFirmId(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel Subscription Confirmation */}
      <AlertDialog open={cancelOrgId !== null} onOpenChange={(open) => !open && setCancelOrgId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Subscription</AlertDialogTitle>
            <AlertDialogDescription>
              This will cancel the firm's subscription at the end of their current billing period.
              They will retain access until then.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Active</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => cancelOrgId && cancelSub.mutate({ organizationId: cancelOrgId })}
            >
              Cancel Subscription
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function MetricCard({
  title,
  value,
  icon,
  loading,
}: {
  title: string;
  value?: number | string;
  icon: React.ReactNode;
  loading: boolean;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            {loading ? (
              <Skeleton className="h-8 w-16 mt-1" />
            ) : (
              <p className="text-2xl font-bold mt-1">{value ?? 0}</p>
            )}
          </div>
          <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
