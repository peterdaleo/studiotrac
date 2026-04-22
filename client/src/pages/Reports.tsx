import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useEffectiveAdmin } from "@/contexts/StaffPreviewContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Download,
  FileSpreadsheet,
  Building2,
  ListTodo,
  Users,
  DollarSign,
  Loader2,
} from "lucide-react";

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

function escapeCSV(val: unknown): string {
  if (val === null || val === undefined) return "";
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export default function Reports() {
  const [loadingReport, setLoadingReport] = useState<string | null>(null);
  const { user } = useAuth();
  const isAdmin = useEffectiveAdmin(user?.role);

  const projectsQuery = trpc.exports.projectsSummary.useQuery(undefined, { enabled: false });
  const tasksQuery = trpc.exports.tasksList.useQuery(undefined, { enabled: false });
  const teamQuery = trpc.exports.teamWorkload.useQuery(undefined, { enabled: false });

  const handleExportProjects = async () => {
    setLoadingReport("projects");
    try {
      const result = await projectsQuery.refetch();
      if (result.data) {
        const headers = ["Project Name", "Client", "Status", "Phase", "Completion %", "Start Date", "Deadline", "Project Manager", "Contracted Fee", "Invoiced Amount", "Billing OK"];
        const rows = result.data.map((p: any) => [
          escapeCSV(p.name),
          escapeCSV(p.clientName),
          escapeCSV(p.status),
          escapeCSV(p.phase),
          p.completionPercentage,
          p.startDate ? new Date(p.startDate).toLocaleDateString() : "",
          p.deadline ? new Date(p.deadline).toLocaleDateString() : "",
          escapeCSV(p.projectManagerName),
          p.contractedFee ? `$${(p.contractedFee / 100).toLocaleString()}` : "",
          p.invoicedAmount ? `$${(p.invoicedAmount / 100).toLocaleString()}` : "",
          p.billingOk ? "Yes" : "No",
        ]);
        const csv = [headers.join(","), ...rows.map((r: any[]) => r.join(","))].join("\n");
        downloadCSV(`studiotrac-projects-${new Date().toISOString().split("T")[0]}.csv`, csv);
        toast.success("Projects report downloaded");
      }
    } catch {
      toast.error("Failed to generate report");
    }
    setLoadingReport(null);
  };

  const handleExportTasks = async () => {
    setLoadingReport("tasks");
    try {
      const result = await tasksQuery.refetch();
      if (result.data) {
        const headers = ["Task", "Project", "Assignee", "Priority", "Status", "Deadline", "Created", "Completed"];
        const rows = result.data.map((t: any) => [
          escapeCSV(t.title),
          escapeCSV(t.projectName),
          escapeCSV(t.assigneeName),
          t.priority,
          escapeCSV(t.status),
          t.deadline ? new Date(t.deadline).toLocaleDateString() : "",
          t.createdAt ? new Date(t.createdAt).toLocaleDateString() : "",
          t.completedAt ? new Date(t.completedAt).toLocaleDateString() : "",
        ]);
        const csv = [headers.join(","), ...rows.map((r: any[]) => r.join(","))].join("\n");
        downloadCSV(`studiotrac-tasks-${new Date().toISOString().split("T")[0]}.csv`, csv);
        toast.success("Tasks report downloaded");
      }
    } catch {
      toast.error("Failed to generate report");
    }
    setLoadingReport(null);
  };

  const handleExportTeam = async () => {
    setLoadingReport("team");
    try {
      const result = await teamQuery.refetch();
      if (result.data) {
        const headers = ["Team Member", "Role", "Active Tasks", "Completed Tasks", "Overdue Tasks", "Projects Assigned"];
        const rows = result.data.map((m: any) => [
          escapeCSV(m.name),
          escapeCSV(m.role),
          m.activeTasks,
          m.completedTasks,
          m.overdueTasks,
          m.projectCount,
        ]);
        const csv = [headers.join(","), ...rows.map((r: any[]) => r.join(","))].join("\n");
        downloadCSV(`studiotrac-team-workload-${new Date().toISOString().split("T")[0]}.csv`, csv);
        toast.success("Team workload report downloaded");
      }
    } catch {
      toast.error("Failed to generate report");
    }
    setLoadingReport(null);
  };

  const reports = [
    {
      id: "projects",
      title: "Projects Summary",
      description: "Export all projects with status, phase, completion, deadlines, budget, and billing information. Ideal for client presentations and management reviews.",
      icon: Building2,
      color: "text-blue-500",
      bgColor: "bg-blue-500/10",
      fields: ["Project Name", "Client", "Status", "Phase", "Completion %", "Dates", "Budget", "Billing OK"],
      handler: handleExportProjects,
    },
    {
      id: "tasks",
      title: "Tasks Report",
      description: "Export all tasks across projects with assignments, priorities, deadlines, and completion status. Great for workload analysis and deadline tracking.",
      icon: ListTodo,
      color: "text-amber-500",
      bgColor: "bg-amber-500/10",
      fields: ["Task", "Project", "Assignee", "Priority", "Status", "Deadline", "Created", "Completed"],
      handler: handleExportTasks,
    },
    {
      id: "team",
      title: "Team Workload",
      description: "Export team member workload data including active tasks, completed tasks, overdue items, and project assignments. Useful for resource planning.",
      icon: Users,
      color: "text-emerald-500",
      bgColor: "bg-emerald-500/10",
      fields: ["Name", "Role", "Active Tasks", "Completed", "Overdue", "Projects"],
      handler: handleExportTeam,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Reports & Exports</h1>
        <p className="text-muted-foreground mt-1">
          Download project data as CSV files for presentations, reviews, and analysis.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {reports.map((report) => {
          const Icon = report.icon;
          const isLoading = loadingReport === report.id;
          return (
            <Card key={report.id} className="border-0 shadow-sm hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-start gap-3">
                  <div className={`p-2.5 rounded-lg ${report.bgColor}`}>
                    <Icon className={`h-5 w-5 ${report.color}`} />
                  </div>
                  <div className="flex-1">
                    <CardTitle className="text-base font-semibold">{report.title}</CardTitle>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {report.description}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {report.fields.map((field) => (
                    <Badge key={field} variant="outline" className="text-[10px] font-normal">
                      {field}
                    </Badge>
                  ))}
                </div>
                <Separator />
                <Button
                  onClick={report.handler}
                  disabled={isLoading}
                  className="w-full"
                  variant="outline"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4 mr-2" />
                      Download CSV
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Financial Summary Card */}
      {isAdmin && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-purple-500/10">
                <DollarSign className="h-5 w-5 text-purple-500" />
              </div>
              <div>
                <CardTitle className="text-base font-semibold">Financial Reports</CardTitle>
                <p className="text-sm text-muted-foreground mt-0.5">
                  For detailed financial data including invoices, visit the{" "}
                  <a href="/financials" className="text-primary hover:underline font-medium">
                    Financials page
                  </a>
                  .
                </p>
              </div>
            </div>
          </CardHeader>
        </Card>
      )}

      <div className="text-xs text-muted-foreground text-center py-4">
        <FileSpreadsheet className="h-4 w-4 inline mr-1.5" />
        All reports are exported in CSV format, compatible with Excel, Google Sheets, and other spreadsheet applications.
      </div>
    </div>
  );
}
