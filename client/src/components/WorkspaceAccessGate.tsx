import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { canManageBilling } from "@shared/billingAccess";
import { AlertCircle, Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type AccessUser = {
  isSuperAdmin?: boolean | null;
  orgRole?: string | null;
  organizationId?: number | null;
} | null | undefined;

type WorkspaceAccess = {
  managed?: boolean;
  state?: "legacy" | "pending" | "active" | "suspended";
  allowed?: boolean;
  reason?: "awaiting_approval" | "suspended" | "no_entitlement" | null;
};

/** Pure policy helper, kept explicit so route behavior can be tested without mounting the app. */
export function shouldRenderManagedWorkspace(
  access: WorkspaceAccess | null | undefined,
  pathname: string,
  user: AccessUser,
): boolean {
  // Older servers and all unmanaged/legacy accounts retain their previous UI behavior.
  if (!access || access.managed !== true) return true;
  const hasValidOrganization = Number.isSafeInteger(user?.organizationId) && (user?.organizationId ?? 0) > 0;
  const platformAdministratorPage = pathname.startsWith("/admin/platform") && user?.isSuperAdmin === true;
  const ownerBillingRecovery = pathname === "/billing" && hasValidOrganization && canManageBilling(user);
  return access.allowed === true || platformAdministratorPage || ownerBillingRecovery;
}

function AccessMessage({ access, canRecoverBilling }: { access: WorkspaceAccess; canRecoverBilling: boolean }) {
  let title = "Workspace access is unavailable";
  let description = "Contact the StudioTrac platform owner for help restoring access.";
  if (access.reason === "awaiting_approval" || access.state === "pending") {
    title = "Workspace awaiting approval";
    description = "This workspace is waiting for platform-owner approval. Contact the platform owner for an update.";
  } else if (access.reason === "suspended" || access.state === "suspended") {
    title = "Workspace access is suspended";
    description = "Workspace access has been suspended by the platform owner. Contact them for assistance.";
  } else if (access.reason === "no_entitlement") {
    title = "Workspace access has not been granted";
    description = "This managed workspace does not currently have an active paid subscription or complimentary plan. The organization owner can review billing.";
  }

  return (
    <main className="min-h-screen bg-background p-6 flex items-center justify-center">
      <Card className="w-full max-w-xl border-amber-200">
        <CardHeader>
          <div className="flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-amber-600" aria-hidden="true" />
            <CardTitle>{title}</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{description}</p>
          {canRecoverBilling && (
            <Button asChild><a href="/billing">Review billing</a></Button>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

/**
 * This component must wrap DashboardRouter, not DashboardLayout: denied managed
 * workspaces must not mount any business-page shell or query-bearing children.
 */
export default function WorkspaceAccessGate({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth({ redirectOnUnauthenticated: true });
  const [pathname] = useLocation();
  const { data: current, isLoading, isError } = trpc.subscription.current.useQuery(undefined, {
    enabled: !!user,
    retry: false,
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  });

  if (authLoading || !user || isLoading) {
    return (
      <main className="min-h-screen flex items-center justify-center" aria-label={user ? "Checking workspace access" : "Redirecting to sign in"}>
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  // Once this field is introduced, errors fail closed rather than mounting the business app.
  // A successful legacy response without workspaceAccess remains fully compatible.
  const access = (current as { workspaceAccess?: WorkspaceAccess | null } | null | undefined)?.workspaceAccess;
  if (isError) {
    return (
      <main className="min-h-screen bg-background p-6 flex items-center justify-center">
        <Card className="w-full max-w-xl">
          <CardHeader><CardTitle>Unable to verify workspace access</CardTitle></CardHeader>
          <CardContent><p className="text-sm text-muted-foreground">Refresh the page or contact support if the problem continues.</p></CardContent>
        </Card>
      </main>
    );
  }

  const canRecoverBilling = Number.isSafeInteger(user?.organizationId)
    && (user?.organizationId ?? 0) > 0
    && canManageBilling(user);
  if (!shouldRenderManagedWorkspace(access, pathname, user)) {
    return <AccessMessage access={access!} canRecoverBilling={canRecoverBilling} />;
  }
  return <>{children}</>;
}
