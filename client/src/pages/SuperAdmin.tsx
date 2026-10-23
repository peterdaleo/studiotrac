import { formatAccessAuditDetails } from "@shared/workspaceAudit";
import { getFirmInvitationStatus, partitionFirmInvitations } from "@shared/platformAccessPresentation";
import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { AlertCircle } from "lucide-react";
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
  Copy,
  ShieldCheck,
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

export function canManagePlatformAccess(user: {
  isSuperAdmin?: boolean | null;
  orgRole?: string | null;
  organizationId?: number | null;
} | null | undefined) {
  return user?.isSuperAdmin === true && user.orgRole === "owner"
    && Number.isSafeInteger(user.organizationId) && (user.organizationId ?? 0) > 0;
}

export default function SuperAdmin() {
  const { user } = useAuth({ redirectOnUnauthenticated: true });
  const isSuperAdmin = user?.isSuperAdmin ?? false;
  const isPlatformOwner = canManagePlatformAccess(user);
  const utils = trpc.useUtils();
  const { data: metrics, isLoading: metricsLoading } = trpc.superAdmin.metrics.useQuery(
    undefined, { enabled: isSuperAdmin }
  );
  const { data: firms, isLoading: firmsLoading } = trpc.superAdmin.firms.useQuery(
    undefined, { enabled: isSuperAdmin }
  );

  const [selectedFirmId, setSelectedFirmId] = useState<number | null>(null);
  const [cancelOrgId, setCancelOrgId] = useState<number | null>(null);

  const { data: firmDetail, isLoading: detailLoading } = trpc.superAdmin.firmDetail.useQuery(
    { id: selectedFirmId! },
    { enabled: selectedFirmId !== null }
  );

  if (!isSuperAdmin) {
    return (
      <div className="p-6">
        <Card className="border-amber-200 bg-amber-50/50">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-amber-600" />
              <div>
                <p className="font-medium text-amber-900">Access denied</p>
                <p className="text-sm text-amber-800/90">
                  This page is restricted to platform administrators.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

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

      {isPlatformOwner && <PlatformAccessManager firms={firms ?? []} protectedOrganizationId={user?.organizationId ?? 0} />}

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

type FirmRow = { id: number; name: string; planTier: string; subscriptionStatus: string };
type PlatformAction = "suspend" | "revokeComplimentary" | "revokeInvitation" | "archiveWorkspace" | "restoreWorkspace";

function PlatformAccessManager({ firms, protectedOrganizationId }: { firms: FirmRow[]; protectedOrganizationId: number }) {
  const utils = trpc.useUtils();
  const [email, setEmail] = useState("");
  const [firmName, setFirmName] = useState("");
  const [issuedLink, setIssuedLink] = useState<string | null>(null);
  const [inviteComplimentaryPlan, setInviteComplimentaryPlan] = useState<"starter" | "professional" | "enterprise">("starter");
  const [complimentaryPlan, setComplimentaryPlan] = useState<Record<number, "starter" | "professional" | "enterprise">>({});
  const [action, setAction] = useState<{ kind: PlatformAction; organizationId?: number; invitationId?: number; label: string } | null>(null);
  const [reason, setReason] = useState("");

  const overview = trpc.platformAccess.overview.useQuery(undefined, { retry: false });
  const audit = trpc.platformAccess.audit.useQuery({ limit: 50 }, { retry: false });
  const refresh = () => {
    utils.platformAccess.overview.invalidate();
    utils.platformAccess.audit.invalidate();
  };
  const issueInvite = trpc.platformAccess.inviteFirmOwner.useMutation({
    onSuccess: (result) => {
      setIssuedLink(result.invitationUrl);
      setEmail("");
      setFirmName("");
      setInviteComplimentaryPlan("starter");
      refresh();
      if (result.emailSent) toast.success("Owner invitation emailed. Copy the one-time link now if you also want a backup copy.");
      else toast.warning("Invitation created, but email was not sent. Copy and send the link to the owner.");
    },
    onError: (error) => toast.error(error.message),
  });
  const grantWorkspace = trpc.platformAccess.grantWorkspaceAccess.useMutation({ onSuccess: refresh, onError: (error) => toast.error(error.message) });
  const suspendWorkspace = trpc.platformAccess.suspendWorkspace.useMutation({ onSuccess: () => { refresh(); setAction(null); setReason(""); }, onError: (error) => toast.error(error.message) });
  const reactivateWorkspace = trpc.platformAccess.reactivateWorkspace.useMutation({ onSuccess: refresh, onError: (error) => toast.error(error.message) });
  const grantComplimentary = trpc.platformAccess.grantComplimentaryPlan.useMutation({ onSuccess: refresh, onError: (error) => toast.error(error.message) });
  const revokeComplimentary = trpc.platformAccess.revokeComplimentaryPlan.useMutation({ onSuccess: () => { refresh(); setAction(null); setReason(""); }, onError: (error) => toast.error(error.message) });
  const revokeInvitation = trpc.platformAccess.revokeFirmInvitation.useMutation({ onSuccess: () => { refresh(); setAction(null); setReason(""); }, onError: (error) => toast.error(error.message) });

  const controls = overview.data?.controls ?? [];
  const invitations = overview.data?.invitations ?? [];
  const archivedOrganizationIds = new Set(controls.filter((row) => row.archived).map((row) => row.organizationId));
  const currentWorkspaceFirms = firms.filter((firm) => !archivedOrganizationIds.has(firm.id));
  const archivedFirms = firms.filter((firm) => archivedOrganizationIds.has(firm.id));
  const { current: currentInvitations, history: invitationHistory } = partitionFirmInvitations(invitations);
  const audits = audit.data ?? [];
  const archiveWorkspace = trpc.platformAccess.archiveWorkspace.useMutation({ onSuccess: () => { refresh(); setAction(null); setReason(""); }, onError: (error) => toast.error(error.message) });
  const unarchiveWorkspace = trpc.platformAccess.unarchiveWorkspace.useMutation({ onSuccess: () => { refresh(); setAction(null); setReason(""); }, onError: (error) => toast.error(error.message) });
  const isActionPending = suspendWorkspace.isPending || revokeComplimentary.isPending || revokeInvitation.isPending || archiveWorkspace.isPending || unarchiveWorkspace.isPending;

  function submitReasonedAction() {
    if (!action || !reason.trim()) return;
    if (action.kind === "suspend" && action.organizationId) suspendWorkspace.mutate({ organizationId: action.organizationId, reason: reason.trim() });
    if (action.kind === "revokeComplimentary" && action.organizationId) revokeComplimentary.mutate({ organizationId: action.organizationId, reason: reason.trim() });
    if (action.kind === "revokeInvitation" && action.invitationId) revokeInvitation.mutate({ invitationId: action.invitationId, reason: reason.trim() });
    if (action.kind === "archiveWorkspace" && action.organizationId) archiveWorkspace.mutate({ organizationId: action.organizationId, reason: reason.trim() });
    if (action.kind === "restoreWorkspace" && action.organizationId) unarchiveWorkspace.mutate({ organizationId: action.organizationId, reason: reason.trim() });
  }

  function renderInvitation(invite: typeof invitations[number]) {
    const status = getFirmInvitationStatus(invite);
    return <div key={invite.id} className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 text-sm last:border-0">
      <div><span className="font-medium">{invite.firmName}</span><span className="ml-2 text-muted-foreground">{invite.email}</span><div className="text-xs text-muted-foreground">{status} · expires {formatDate(invite.expiresAt)}</div></div>
      {status === "Pending" && <Button size="sm" variant="outline" onClick={() => { setReason(""); setAction({ kind: "revokeInvitation", invitationId: invite.id, label: `Revoke invitation for ${invite.email}` }); }}>Revoke invitation</Button>}
    </div>;
  }

  return (
    <section className="space-y-5" aria-labelledby="platform-access-heading">
      <div>
        <h2 id="platform-access-heading" className="text-xl font-semibold flex items-center gap-2"><ShieldCheck className="h-5 w-5" />Workspace access management</h2>
        <p className="mt-1 text-sm text-muted-foreground">Manual workspace access and complimentary plans are separate from Stripe. Suspending access does not stop billing. Archive is available only for suspended workspaces and can be reversed.</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Invite a firm owner</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">Firm name<input className="w-full rounded-md border bg-background px-3 py-2" value={firmName} onChange={(event) => setFirmName(event.target.value)} maxLength={255} /></label>
            <label className="space-y-1 text-sm">Owner email<input type="email" className="w-full rounded-md border bg-background px-3 py-2" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={320} /></label>
          </div>
          <label className="block space-y-1 text-sm" htmlFor="invite-complimentary-plan">Complimentary plan
            <select id="invite-complimentary-plan" className="block w-full rounded-md border bg-background px-3 py-2" value={inviteComplimentaryPlan} onChange={(event) => setInviteComplimentaryPlan(event.target.value as "starter" | "professional" | "enterprise")}>
              <option value="starter">Starter</option><option value="professional">Professional</option><option value="enterprise">Enterprise</option>
            </select>
          </label>
          <p className="text-xs text-muted-foreground">Create an invitation for complimentary access on the selected plan. The plan activates when the owner accepts; no second access grant is needed. This is not a trial and will not trigger an automatic charge.</p>
          <Button onClick={() => issueInvite.mutate({ email: email.trim(), firmName: firmName.trim(), complimentaryPlan: inviteComplimentaryPlan })} disabled={!email.trim() || !firmName.trim() || issueInvite.isPending}>
            {issueInvite.isPending ? "Creating invitation…" : `Invite with complimentary ${inviteComplimentaryPlan[0].toUpperCase()}${inviteComplimentaryPlan.slice(1)} access`}
          </Button>
          {issuedLink && <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:bg-amber-950/30">
            <p className="font-medium">One-time invitation link</p>
            <p className="mt-1 break-all"><a className="underline" href={issuedLink}>{issuedLink}</a></p>
            <p className="mt-1 text-muted-foreground">Copy this link now. The raw link is shown only in this session and is never written to audit logs.</p>
            <Button className="mt-2" variant="outline" size="sm" onClick={() => { void navigator.clipboard?.writeText(issuedLink).then(() => toast.success("Invitation link copied")); }}><Copy className="mr-2 h-4 w-4" />Copy link</Button>
          </div>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Workspace and complimentary access</CardTitle></CardHeader>
        <CardContent>
          {overview.isLoading ? <Skeleton className="h-16 w-full" /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b text-left text-muted-foreground"><th className="pb-2 pr-3">Firm</th><th className="pb-2 pr-3">Workspace access</th><th className="pb-2 pr-3">Complimentary plan</th><th className="pb-2">Platform actions</th></tr></thead>
                <tbody>{currentWorkspaceFirms.map((firm) => {
                  const control = controls.find((row) => row.organizationId === firm.id);
                  const state = control?.state ?? "legacy";
                  const manualPlan = control?.complimentaryPlan ?? null;
                  return <tr key={firm.id} className="border-b last:border-0 align-top">
                    <td className="py-3 pr-3 font-medium">{firm.name}</td>
                    <td className="py-3 pr-3"><Badge variant={state === "suspended" ? "destructive" : state === "active" ? "secondary" : "outline"}>{state}</Badge><div className="mt-1 text-xs text-muted-foreground">Stripe: {firm.subscriptionStatus}</div></td>
                    <td className="py-3 pr-3">{manualPlan ? <Badge variant="outline">{manualPlan}</Badge> : <span className="text-muted-foreground">None</span>}</td>
                    <td className="py-3">{firm.id === protectedOrganizationId ? <span className="text-muted-foreground">Protected platform-owner firm</span> : <div className="flex min-w-[330px] flex-wrap items-center gap-2">
                      {(state === "pending" || state === "suspended") && <Button size="sm" variant="outline" disabled={grantWorkspace.isPending || reactivateWorkspace.isPending} onClick={() => state === "suspended" ? reactivateWorkspace.mutate({ organizationId: firm.id }) : grantWorkspace.mutate({ organizationId: firm.id })}>Grant / reactivate access</Button>}
                      {(state === "active" || state === "legacy") && <Button size="sm" variant="destructive" onClick={() => { setReason(""); setAction({ kind: "suspend", organizationId: firm.id, label: `Suspend access for ${firm.name}` }); }}>Suspend</Button>}
                      {state === "suspended" && <Button size="sm" variant="outline" disabled={archiveWorkspace.isPending} onClick={() => { setReason(""); setAction({ kind: "archiveWorkspace", organizationId: firm.id, label: `Archive ${firm.name}` }); }}>Archive</Button>}
                      <select aria-label={`Complimentary plan for ${firm.name}`} className="rounded-md border bg-background px-2 py-1.5" value={complimentaryPlan[firm.id] ?? "starter"} onChange={(event) => setComplimentaryPlan((previous) => ({ ...previous, [firm.id]: event.target.value as "starter" | "professional" | "enterprise" }))}>
                        <option value="starter">Starter</option><option value="professional">Professional</option><option value="enterprise">Enterprise</option>
                      </select>
                      <Button size="sm" variant="outline" disabled={grantComplimentary.isPending} onClick={() => grantComplimentary.mutate({ organizationId: firm.id, plan: complimentaryPlan[firm.id] ?? "starter" })}>Grant plan</Button>
                      {manualPlan && <Button size="sm" variant="ghost" onClick={() => { setReason(""); setAction({ kind: "revokeComplimentary", organizationId: firm.id, label: `Revoke complimentary plan for ${firm.name}` }); }}>Revoke plan</Button>}
                    </div>}</td>
                  </tr>;
                })}</tbody>
              </table>
              {currentWorkspaceFirms.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No current workspaces are available.</p>}
              <p className="mt-3 text-xs text-muted-foreground">Workspace state, complimentary plan, and Stripe subscription status are independent. Suspending access does not cancel a Stripe subscription.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {archivedFirms.length > 0 && <Card>
        <CardHeader><CardTitle className="text-base">Archived workspaces</CardTitle></CardHeader>
        <CardContent>
          <details>
            <summary className="cursor-pointer text-sm font-medium">Archived workspaces ({archivedFirms.length})</summary>
            <div className="mt-3 space-y-2">
              {archivedFirms.map((firm) => {
                const control = controls.find((row) => row.organizationId === firm.id);
                return <div key={firm.id} className="flex flex-wrap items-center justify-between gap-3 border-b pb-2 text-sm last:border-0">
                  <div><span className="font-medium">{firm.name}</span><div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><Badge variant="outline">Archived</Badge><span>Access remains suspended</span>{control?.complimentaryPlan && <Badge variant="outline">{control.complimentaryPlan}</Badge>}</div></div>
                  <Button size="sm" variant="outline" disabled={unarchiveWorkspace.isPending} onClick={() => { setReason(""); setAction({ kind: "restoreWorkspace", organizationId: firm.id, label: `Restore ${firm.name} to suspended workspaces` }); }}>Restore</Button>
                </div>;
              })}
            </div>
          </details>
        </CardContent>
      </Card>}

      <Card>
        <CardHeader><CardTitle className="text-base">Owner invitations</CardTitle></CardHeader>
        <CardContent>
          {currentInvitations.length === 0 && invitationHistory.length === 0 ? <p className="text-sm text-muted-foreground">No invitations.</p> : <div className="space-y-3">
            <div className="space-y-2">{currentInvitations.length === 0 ? <p className="text-sm text-muted-foreground">No current invitations.</p> : currentInvitations.map(renderInvitation)}</div>
            {invitationHistory.length > 0 && <details className="rounded-md border p-3">
              <summary className="cursor-pointer text-sm font-medium">History ({invitationHistory.length})</summary>
              <div className="mt-3 space-y-2">{invitationHistory.map(renderInvitation)}</div>
            </details>}
          </div>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Platform access audit</CardTitle></CardHeader>
        <CardContent>
          {audit.isLoading ? <Skeleton className="h-16 w-full" /> : audits.length === 0 ? <p className="text-sm text-muted-foreground">No access-management audit events.</p> : <div className="max-h-72 space-y-2 overflow-y-auto">{audits.map((event) => <div key={event.id} className="flex flex-wrap justify-between gap-x-4 border-b pb-2 text-sm last:border-0"><div><span className="font-medium">{event.action.replaceAll("_", " ")}</span><span className="ml-2 text-muted-foreground">{event.organizationId ? `Organization ${event.organizationId}` : event.invitationId ? `Invitation ${event.invitationId}` : "Platform"}</span>{event.details && <p className="mt-0.5 text-xs text-muted-foreground">{formatAccessAuditDetails(event.details)}</p>}<p className="text-xs text-muted-foreground">Actor {event.actorUserId}</p>{event.reason && <p className="mt-0.5 text-xs text-muted-foreground">Reason: {event.reason}</p>}</div><time className="text-xs text-muted-foreground">{formatDate(event.createdAt)}</time></div>)}</div>}
        </CardContent>
      </Card>

      <AlertDialog open={action !== null} onOpenChange={(open) => { if (!open) { setAction(null); setReason(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm {action?.label}</AlertDialogTitle>
            <AlertDialogDescription>This action will be recorded in the platform access audit. Enter a reason before continuing.</AlertDialogDescription>
          </AlertDialogHeader>
          <textarea aria-label="Reason for platform access change" className="min-h-24 w-full rounded-md border bg-background p-2 text-sm" maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} />
          <AlertDialogFooter>
            <AlertDialogCancel>Keep unchanged</AlertDialogCancel>
            <AlertDialogAction disabled={!reason.trim() || isActionPending} onClick={(event) => { event.preventDefault(); submitReasonedAction(); }} className={action?.kind === "restoreWorkspace" ? "bg-primary text-primary-foreground hover:bg-primary/90" : "bg-destructive text-destructive-foreground hover:bg-destructive/90"}>{action?.kind === "restoreWorkspace" ? "Restore and record" : "Confirm and record"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
