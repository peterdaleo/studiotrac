import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  MapPin,
  Calendar,
  CheckCircle2,
  Circle,
  DollarSign,
  FileText,
  File,
  Image as ImageIcon,
  Download,
  Eye,
  Paperclip,
  MessageSquare,
  Building2,
  Clock,
  Shield,
} from "lucide-react";
import { useParams } from "wouter";
import { PROJECT_PHASES, getPhaseLabel } from "@shared/constants";

const statusColorMap: Record<string, string> = {
  on_track: "bg-emerald-500/10 text-emerald-700 border-emerald-200",
  on_hold: "bg-amber-500/10 text-amber-700 border-amber-200",
  delayed: "bg-red-500/10 text-red-700 border-red-200",
  completed: "bg-slate-500/10 text-slate-600 border-slate-200",
};

const statusLabelMap: Record<string, string> = {
  on_track: "On Track",
  on_hold: "On Hold",
  delayed: "Delayed",
  completed: "Completed",
};

export default function ClientPortal() {
  const params = useParams<{ token: string }>();
  const token = params.token || "";

  const { data, isLoading, error } = trpc.portal.getProject.useQuery(
    { token },
    { enabled: !!token, retry: false }
  );

  const getFileIcon = (mimeType?: string | null) => {
    if (!mimeType) return <File className="h-4 w-4" />;
    if (mimeType.startsWith("image/")) return <ImageIcon className="h-4 w-4" />;
    if (mimeType.includes("pdf")) return <FileText className="h-4 w-4 text-red-500" />;
    return <File className="h-4 w-4" />;
  };

  const formatFileSize = (bytes?: number | null) => {
    if (!bytes) return "";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
        <div className="max-w-4xl mx-auto px-4 py-12">
          <Skeleton className="h-12 w-64 mb-4" />
          <Skeleton className="h-6 w-96 mb-8" />
          <Skeleton className="h-64 rounded-xl mb-6" />
          <Skeleton className="h-48 rounded-xl" />
        </div>
      </div>
    );
  }

  if (data?.error || !data?.data) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white flex items-center justify-center">
        <div className="text-center max-w-md px-6">
          <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-6">
            <Shield className="h-8 w-8 text-red-400" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-3">Link Unavailable</h1>
          <p className="text-slate-500 leading-relaxed">
            {data?.error || "This project link is invalid, expired, or has been revoked. Please contact your project team for an updated link."}
          </p>
        </div>
      </div>
    );
  }

  const { project, notes, files } = data.data;
  const currentPhaseIndex = PROJECT_PHASES.findIndex((p) => p.value === project.phase);

  const billingMilestones = [
    { label: "25%", reached: project.billing25 },
    { label: "50%", reached: project.billing50 },
    { label: "75%", reached: project.billing75 },
    { label: "100%", reached: project.billing100 },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      {/* Header bar */}
      <div className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            <span className="font-semibold text-sm tracking-tight">studioTrac</span>
            <span className="text-xs text-muted-foreground">Client Portal</span>
          </div>
          <Badge variant="outline" className="text-xs">
            <Eye className="h-3 w-3 mr-1" /> Read Only
          </Badge>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
        {/* Project Header */}
        <div>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-slate-900">{project.name}</h1>
              <div className="flex items-center gap-3 mt-2 text-sm text-slate-500 flex-wrap">
                {project.clientName && <span className="font-medium text-slate-700">{project.clientName}</span>}
                {project.address && (
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5" /> {project.address}
                  </span>
                )}
              </div>
            </div>
            <Badge className={`text-sm px-3 py-1 ${statusColorMap[project.status] ?? ""}`}>
              {statusLabelMap[project.status] ?? project.status}
            </Badge>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Phase Progression */}
            <Card className="border shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold">Project Phase</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-1 overflow-x-auto pb-2">
                  {PROJECT_PHASES.map((phase, i) => {
                    const isCurrent = i === currentPhaseIndex;
                    const isPast = i < currentPhaseIndex;
                    return (
                      <div
                        key={phase.value}
                        className={`flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                          isCurrent
                            ? "bg-primary text-primary-foreground shadow-sm"
                            : isPast
                            ? "bg-primary/10 text-primary"
                            : "bg-slate-100 text-slate-400"
                        }`}
                      >
                        {isPast ? (
                          <CheckCircle2 className="h-3 w-3" />
                        ) : (
                          <span className="h-4 w-4 rounded-full border-2 flex items-center justify-center text-[9px] shrink-0" style={{ borderColor: "currentColor" }}>
                            {i + 1}
                          </span>
                        )}
                        {phase.shortLabel}
                      </div>
                    );
                  })}
                </div>
                <div className="mt-4">
                  <div className="flex items-center justify-between text-sm mb-2">
                    <span className="text-slate-500">Overall Completion</span>
                    <span className="font-bold text-lg">{project.completionPercentage}%</span>
                  </div>
                  <Progress value={project.completionPercentage} className="h-3" />
                </div>
              </CardContent>
            </Card>

            {/* Files & Documents */}
            {files && files.length > 0 && (
              <Card className="border shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <Paperclip className="h-4 w-4 text-slate-400" />
                    Shared Documents ({files.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {files.map((file: any) => (
                      <div key={file.id} className="flex items-center gap-3 p-3 rounded-lg bg-slate-50 hover:bg-slate-100 transition-colors">
                        {getFileIcon(file.mimeType)}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{file.fileName}</p>
                          <div className="flex items-center gap-2 text-[10px] text-slate-400">
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0">{file.category}</Badge>
                            <span>{formatFileSize(file.fileSize)}</span>
                            <span>{new Date(file.createdAt).toLocaleDateString()}</span>
                          </div>
                        </div>
                        <Button variant="outline" size="sm" asChild>
                          <a href={file.url} target="_blank" rel="noopener noreferrer">
                            <Download className="h-3.5 w-3.5 mr-1" /> Download
                          </a>
                        </Button>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Client-Visible Notes */}
            {notes && notes.length > 0 && (
              <Card className="border shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-slate-400" />
                    Project Updates ({notes.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {notes.map((note: any) => (
                      <div key={note.id} className="bg-slate-50 rounded-lg p-4">
                        <p className="text-sm whitespace-pre-wrap leading-relaxed">{note.content}</p>
                        <div className="flex items-center gap-2 mt-2 text-xs text-slate-400">
                          <Clock className="h-3 w-3" />
                          <span>{new Date(note.createdAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Project Details */}
            <Card className="border shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold">Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  {project.managerName && (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-slate-500">Project Manager</span>
                        <span className="text-sm font-medium">{project.managerName}</span>
                      </div>
                      <Separator />
                    </>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-500">Phase</span>
                    <span className="text-sm font-medium">{getPhaseLabel(project.phase)}</span>
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-500">Start Date</span>
                    <span className="text-sm">
                      {project.startDate ? new Date(project.startDate).toLocaleDateString() : "TBD"}
                    </span>
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-slate-500">Target Completion</span>
                    <span className="text-sm">
                      {project.deadline ? new Date(project.deadline).toLocaleDateString() : "TBD"}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Billing Milestones */}
            <Card className="border shadow-sm">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <DollarSign className="h-4 w-4 text-slate-400" />
                    Billing Progress
                  </CardTitle>
                  <Badge
                    variant={project.billingOk ? "default" : "outline"}
                    className={project.billingOk ? "bg-emerald-500 text-white" : "text-amber-600 border-amber-300"}
                  >
                    {project.billingOk ? "Current" : "Review Needed"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {billingMilestones.map((ms) => (
                    <div key={ms.label} className="flex items-center gap-3 p-2">
                      {ms.reached ? (
                        <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
                      ) : (
                        <Circle className="h-5 w-5 text-slate-200 shrink-0" />
                      )}
                      <span className={`text-sm ${ms.reached ? "font-medium text-slate-900" : "text-slate-400"}`}>
                        {ms.label} Milestone
                      </span>
                      <div className="flex-1" />
                      <div className={`h-1.5 w-8 rounded-full ${ms.reached ? "bg-emerald-500" : "bg-slate-100"}`} />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Description */}
            {project.description && (
              <Card className="border shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold">About This Project</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-slate-500 leading-relaxed">{project.description}</p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t pt-6 mt-12 text-center">
          <p className="text-xs text-slate-400">
            Powered by <span className="font-semibold">studioTrac</span> — Project Management for Architecture & Design Studios
          </p>
        </div>
      </div>
    </div>
  );
}
