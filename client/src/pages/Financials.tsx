import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useEffectiveAdmin } from "@/contexts/StaffPreviewContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DollarSign, TrendingUp, AlertCircle, CheckCircle2, FileText, ArrowUpRight, Download, PieChart as PieChartIcon } from "lucide-react";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, Legend } from "recharts";
import { Link } from "wouter";
import { getStatusLabel } from "@shared/constants";
import { toast } from "sonner";

function formatCurrency(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(cents / 100);
}

function formatCurrencyShort(cents: number) {
  const val = cents / 100;
  if (val >= 1000000) return `$${(val / 1000000).toFixed(1)}M`;
  if (val >= 1000) return `$${(val / 1000).toFixed(0)}K`;
  return `$${val.toFixed(0)}`;
}

export default function Financials() {
  const { user } = useAuth();
  const { data, isLoading } = trpc.financials.overview.useQuery();
  const exportQuery = trpc.exports.projectsSummary.useQuery(undefined, { enabled: false });

  const isAdmin = useEffectiveAdmin(user?.role);

  const handleExportCSV = async () => {
    const result = await exportQuery.refetch();
    if (!result.data) return;
    const headers = ["Project", "Client", "Manager", "Status", "Phase", "Completion %", "Contracted Fee", "Invoiced Amount"];
    const rows = result.data.map(p => [p.name, p.client, p.manager, p.status, p.phase, p.completion, p.contractedFee, p.invoicedAmount]);
    const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `studiotrac-financial-report-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Financial report exported");
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="h-8 w-48 bg-muted animate-pulse rounded" />
            <div className="h-4 w-64 bg-muted animate-pulse rounded mt-2" />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-32 bg-muted animate-pulse rounded-lg" />)}
        </div>
      </div>
    );
  }

  const totals = data?.totals ?? { contracted: 0, invoiced: 0, outstanding: 0, paid: 0, consultantPaid: 0, netIncome: 0 };
  const projectsData = data?.projects ?? [];
  const activeProjects = projectsData.filter(p => p.status !== "completed");

  // Pie chart data for payment status
  const pieData = [
    { name: "Paid", value: totals.paid, color: "#10b981" },
    { name: "Outstanding", value: totals.outstanding, color: "#f59e0b" },
    { name: "Unbilled", value: Math.max(0, totals.contracted - totals.invoiced), color: "#e2e8f0" },
  ].filter(d => d.value > 0);

  // Bar chart data for top projects by fee
  const barData = activeProjects
    .filter(p => p.contractedFee > 0)
    .sort((a, b) => b.contractedFee - a.contractedFee)
    .slice(0, 8)
    .map(p => ({
      name: p.name.length > 20 ? p.name.substring(0, 18) + "…" : p.name,
      contracted: p.contractedFee / 100,
      invoiced: p.totalInvoiced / 100,
      paid: p.totalPaid / 100,
    }));

  const collectionRate = totals.invoiced > 0 ? ((totals.paid / totals.invoiced) * 100).toFixed(0) : "0";

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Financial Overview</h1>
          <p className="text-muted-foreground">Studio-wide budget tracking and billing status</p>
        </div>
        <Button variant="outline" onClick={handleExportCSV} className="gap-2">
          <Download className="h-4 w-4" />
          Export CSV
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-l-4 border-l-blue-500">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Contracted</p>
                <p className="text-2xl font-bold">{formatCurrency(totals.contracted)}</p>
                <p className="text-xs text-muted-foreground mt-1">{activeProjects.filter(p => p.contractedFee > 0).length} active projects</p>
              </div>
              <div className="h-10 w-10 rounded-full bg-blue-500/10 flex items-center justify-center">
                <DollarSign className="h-5 w-5 text-blue-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-emerald-500">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Paid</p>
                <p className="text-2xl font-bold">{formatCurrency(totals.paid)}</p>
                <p className="text-xs text-muted-foreground mt-1">{collectionRate}% collection rate</p>
              </div>
              <div className="h-10 w-10 rounded-full bg-emerald-500/10 flex items-center justify-center">
                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-amber-500">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Outstanding</p>
                <p className="text-2xl font-bold">{formatCurrency(totals.outstanding)}</p>
                <p className="text-xs text-muted-foreground mt-1">Invoiced but unpaid</p>
              </div>
              <div className="h-10 w-10 rounded-full bg-amber-500/10 flex items-center justify-center">
                <AlertCircle className="h-5 w-5 text-amber-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-violet-500">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Consultant Costs</p>
                <p className="text-2xl font-bold">{formatCurrency(totals.consultantPaid)}</p>
                <p className="text-xs text-muted-foreground mt-1">Total paid to consultants</p>
              </div>
              <div className="h-10 w-10 rounded-full bg-violet-500/10 flex items-center justify-center">
                <FileText className="h-5 w-5 text-violet-500" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Net Income Banner */}
      <Card className={`border-l-4 ${totals.netIncome >= 0 ? 'border-l-emerald-500 bg-emerald-50/50' : 'border-l-red-500 bg-red-50/50'}`}>
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className={`h-12 w-12 rounded-full flex items-center justify-center ${totals.netIncome >= 0 ? 'bg-emerald-500/10' : 'bg-red-500/10'}`}>
                <TrendingUp className={`h-6 w-6 ${totals.netIncome >= 0 ? 'text-emerald-500' : 'text-red-500'}`} />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Studio Net Income</p>
                <p className={`text-3xl font-bold ${totals.netIncome >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {totals.netIncome >= 0 ? '' : '-'}{formatCurrency(Math.abs(totals.netIncome))}
                </p>
              </div>
            </div>
            <div className="text-right space-y-1">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Fees Collected:</span>
                <span className="font-medium text-emerald-600">{formatCurrency(totals.paid)}</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Consultant Costs:</span>
                <span className="font-medium text-red-500">-{formatCurrency(totals.consultantPaid)}</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Unbilled:</span>
                <span className="font-medium">{formatCurrency(Math.max(0, totals.contracted - totals.invoiced))}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Payment Status Pie Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PieChartIcon className="h-5 w-5 text-muted-foreground" />
              Payment Status Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            {pieData.length > 0 ? (
              <div className="flex items-center justify-center gap-8">
                <ResponsiveContainer width={200} height={200}>
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" stroke="none">
                      {pieData.map((entry, index) => (
                        <Cell key={index} fill={entry.color} />
                      ))}
                    </Pie>
                    <RechartsTooltip formatter={(value: number) => formatCurrency(value)} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-3">
                  {pieData.map((entry, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: entry.color }} />
                      <div>
                        <p className="text-sm font-medium">{entry.name}</p>
                        <p className="text-xs text-muted-foreground">{formatCurrency(entry.value)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="h-48 flex items-center justify-center text-muted-foreground">No financial data yet</div>
            )}
          </CardContent>
        </Card>

        {/* Revenue by Project Bar Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-muted-foreground" />
              Revenue by Project
            </CardTitle>
          </CardHeader>
          <CardContent>
            {barData.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={barData} layout="vertical" margin={{ left: 0, right: 16 }}>
                  <XAxis type="number" tickFormatter={(v) => formatCurrencyShort(v * 100)} fontSize={11} />
                  <YAxis type="category" dataKey="name" width={120} fontSize={11} tick={{ fill: "hsl(var(--muted-foreground))" }} />
                  <RechartsTooltip formatter={(value: number) => `$${value.toLocaleString()}`} />
                  <Legend />
                  <Bar dataKey="contracted" name="Contracted" fill="#6366f1" radius={[0, 2, 2, 0]} barSize={12} />
                  <Bar dataKey="paid" name="Paid" fill="#10b981" radius={[0, 2, 2, 0]} barSize={12} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-48 flex items-center justify-center text-muted-foreground">No project fees set yet</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Project Financial Table */}
      <Card>
        <CardHeader>
          <CardTitle>Project Budget Details</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-3 font-medium text-muted-foreground">Project</th>
                  <th className="pb-3 font-medium text-muted-foreground">Status</th>
                  <th className="pb-3 font-medium text-muted-foreground text-right">Contracted Fee</th>
                  <th className="pb-3 font-medium text-muted-foreground text-right">Invoiced</th>
                  <th className="pb-3 font-medium text-muted-foreground text-right">Paid</th>
                  <th className="pb-3 font-medium text-muted-foreground text-right">Outstanding</th>
                  <th className="pb-3 font-medium text-muted-foreground text-right">Consultant Costs</th>
                  <th className="pb-3 font-medium text-muted-foreground text-right">Net Income</th>
                  <th className="pb-3 font-medium text-muted-foreground">Billing Progress</th>
                  <th className="pb-3 font-medium text-muted-foreground"></th>
                </tr>
              </thead>
              <tbody>
                {projectsData.map(p => {
                  const billingPct = p.contractedFee > 0 ? (p.totalPaid / p.contractedFee) * 100 : 0;
                  const statusColor = p.status === "on_track" ? "bg-emerald-500/10 text-emerald-700" :
                    p.status === "delayed" ? "bg-red-500/10 text-red-700" :
                    p.status === "on_hold" ? "bg-amber-500/10 text-amber-700" :
                    "bg-slate-500/10 text-slate-700";
                  return (
                    <tr key={p.id} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                      <td className="py-3">
                        <div>
                          <p className="font-medium">{p.name}</p>
                          <p className="text-xs text-muted-foreground">{p.clientName}</p>
                        </div>
                      </td>
                      <td className="py-3">
                        <Badge variant="secondary" className={statusColor}>
                          {getStatusLabel(p.status)}
                        </Badge>
                      </td>
                      <td className="py-3 text-right font-mono">{p.contractedFee > 0 ? formatCurrency(p.contractedFee) : "—"}</td>
                      <td className="py-3 text-right font-mono">{p.totalInvoiced > 0 ? formatCurrency(p.totalInvoiced) : "—"}</td>
                      <td className="py-3 text-right font-mono text-emerald-600">{p.totalPaid > 0 ? formatCurrency(p.totalPaid) : "—"}</td>
                      <td className="py-3 text-right font-mono">
                        {p.outstanding > 0 ? (
                          <span className="text-amber-600">{formatCurrency(p.outstanding)}</span>
                        ) : "—"}
                      </td>
                      <td className="py-3 text-right font-mono">
                        {(p as any).consultantPaid > 0 ? (
                          <span className="text-violet-600">{formatCurrency((p as any).consultantPaid)}</span>
                        ) : "—"}
                      </td>
                      <td className="py-3 text-right font-mono">
                        {(p as any).netIncome !== undefined && (p.totalPaid > 0 || (p as any).consultantPaid > 0) ? (
                          <span className={(p as any).netIncome >= 0 ? "text-emerald-600 font-semibold" : "text-red-600 font-semibold"}>
                            {(p as any).netIncome >= 0 ? '' : '-'}{formatCurrency(Math.abs((p as any).netIncome))}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="py-3 w-36">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div>
                              <Progress value={Math.min(billingPct, 100)} className="h-2" />
                              <p className="text-xs text-muted-foreground mt-1">{billingPct.toFixed(0)}% collected</p>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            {formatCurrency(p.totalPaid)} of {formatCurrency(p.contractedFee)} collected
                          </TooltipContent>
                        </Tooltip>
                      </td>
                      <td className="py-3">
                        <Link href={`/projects/${p.id}`}>
                          <Button variant="ghost" size="sm" className="gap-1">
                            View <ArrowUpRight className="h-3 w-3" />
                          </Button>
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {projectsData.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <DollarSign className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No projects yet. Create a project to start tracking finances.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {!isAdmin && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-amber-600" />
              <div>
                <p className="font-medium text-amber-900">View Only</p>
                <p className="text-sm text-amber-700">Financial data is read-only for staff members. Contact a principal to update budget or invoice information.</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
