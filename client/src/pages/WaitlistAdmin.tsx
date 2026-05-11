import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useEffectiveAdmin } from "@/contexts/StaffPreviewContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertCircle,
  Download,
  Loader2,
  Users,
  ClipboardList,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

// ── CSV helpers ────────────────────────────────────────────────────

function escapeCSV(val: unknown): string {
  if (val === null || val === undefined) return "";
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function downloadCSV(filename: string, csvContent: string) {
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Password gate ──────────────────────────────────────────────────

const ADMIN_PASSWORD = "studiotrac-admin-2024";

function PasswordGate({ onUnlock }: { onUnlock: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password === ADMIN_PASSWORD) {
      sessionStorage.setItem("waitlist_admin_unlocked", "1");
      onUnlock();
    } else {
      setError(true);
      setPassword("");
    }
  }

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Card className="w-full max-w-sm border shadow-md">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Waitlist Admin</CardTitle>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Enter the admin password to view waitlist signups.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="admin-password">
                Password
              </label>
              <input
                id="admin-password"
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError(false);
                }}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                placeholder="Enter admin password"
                autoFocus
              />
              {error && (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  Incorrect password. Please try again.
                </p>
              )}
            </div>
            <Button type="submit" className="w-full">
              Unlock
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────

export default function WaitlistAdmin() {
  const { user } = useAuth({ redirectOnUnauthenticated: true });
  const isAdmin = useEffectiveAdmin(user?.role);

  // Check session-level password gate
  const [unlocked, setUnlocked] = useState(
    () => sessionStorage.getItem("waitlist_admin_unlocked") === "1",
  );

  const [isExporting, setIsExporting] = useState(false);

  const { data: signups, isLoading, refetch, isFetching } = trpc.waitlist.list.useQuery(
    undefined,
    { enabled: isAdmin && unlocked },
  );

  // Admin role guard
  if (!isAdmin) {
    return (
      <div className="p-6">
        <Card className="border-amber-200 bg-amber-50/50">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-amber-600" />
              <div>
                <p className="font-medium text-amber-900">Admin access required</p>
                <p className="text-sm text-amber-800/90">
                  Only admins can view the waitlist dashboard.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Password gate
  if (!unlocked) {
    return (
      <div className="p-6">
        <PasswordGate onUnlock={() => setUnlocked(true)} />
      </div>
    );
  }

  // Export handler
  function handleExport() {
    if (!signups || signups.length === 0) {
      toast.error("No signups to export.");
      return;
    }
    setIsExporting(true);
    try {
      const headers = ["Name", "Email", "Firm Name", "Firm Size", "Signup Date"];
      const rows = signups.map((s) => [
        escapeCSV(s.name),
        escapeCSV(s.email),
        escapeCSV(s.firmName),
        escapeCSV(s.firmSize),
        escapeCSV(new Date(s.createdAt).toLocaleString()),
      ]);
      const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
      downloadCSV(
        `studiotrac-waitlist-${new Date().toISOString().split("T")[0]}.csv`,
        csv,
      );
      toast.success("Waitlist exported successfully.");
    } catch {
      toast.error("Failed to export waitlist.");
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Waitlist Signups</h1>
          <p className="text-muted-foreground mt-1">
            All users who signed up for early access to StudioTrac.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            {isFetching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            <span className="ml-1.5">Refresh</span>
          </Button>
          <Button
            size="sm"
            onClick={handleExport}
            disabled={isExporting || isLoading || !signups?.length}
          >
            {isExporting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            <span className="ml-1.5">Export CSV</span>
          </Button>
        </div>
      </div>

      {/* Stats card */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card className="border-0 shadow-sm">
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-2.5 rounded-lg bg-primary/10">
                <Users className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Signups</p>
                {isLoading ? (
                  <Skeleton className="h-7 w-12 mt-1" />
                ) : (
                  <p className="text-2xl font-bold">{signups?.length ?? 0}</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold">All Signups</CardTitle>
            {signups && signups.length > 0 && (
              <Badge variant="secondary">{signups.length} total</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : !signups || signups.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <ClipboardList className="h-10 w-10 mb-3 opacity-30" />
              <p className="text-sm font-medium">No signups yet</p>
              <p className="text-xs mt-1">
                Waitlist signups will appear here once people register.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Firm Name</TableHead>
                  <TableHead>Firm Size</TableHead>
                  <TableHead className="pr-6">Signup Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {signups.map((signup) => (
                  <TableRow key={signup.id}>
                    <TableCell className="pl-6 font-medium">{signup.name}</TableCell>
                    <TableCell>
                      <a
                        href={`mailto:${signup.email}`}
                        className="text-primary hover:underline"
                      >
                        {signup.email}
                      </a>
                    </TableCell>
                    <TableCell>{signup.firmName}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs font-normal">
                        {signup.firmSize}
                      </Badge>
                    </TableCell>
                    <TableCell className="pr-6 text-muted-foreground text-sm">
                      {new Date(signup.createdAt).toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
