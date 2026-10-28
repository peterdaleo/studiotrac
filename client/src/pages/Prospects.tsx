import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { ConvertedProspectsSection } from "@/components/ConvertedProspectsSection";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useEffectiveRole } from "@/contexts/StaffPreviewContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ArrowDownWideNarrow, Download, Plus, Printer, Search, UserRound, X } from "lucide-react";
import { computeProspectInsights, groupProspectsByConversion, escapeCsvCell, getFollowUpStatus, localDateKey, matchesProspectOutcomeList, prospectDateInRange, prospectReferralSourceKey, PROSPECT_STAGES, validProspectDate, type ProspectOutcomeListMode, type ProspectStage } from "@shared/prospects";

type ProspectInteraction = {
  id: number;
  type: "note" | "call" | "email" | "meeting" | "proposal";
  content: string;
  happenedAt: Date | string;
  isPrivate: boolean;
  createdById: number | null;
  authorName: string;
};

type ProspectRecord = {
  id: number;
  firm: string;
  opportunityName: string;
  contact: string | null;
  referralSource: string | null;
  stage: ProspectStage;
  closedAt: Date | string | null;
  ownerId: number | null;
  nextFollowUpDate: string | null;
  convertedProjectId: number | null;
  convertedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  lastInteractionAt: Date | string | null;
  interactions: ProspectInteraction[];
};

type ProspectSort = "followup" | "stage" | "owner" | "lastInteraction";
type FollowUpFilter = "all" | "overdue" | "today" | "upcoming" | "none";

type PrintField = "firm" | "opportunityName" | "contact" | "referralSource" | "stage" | "owner" | "nextFollowUpDate" | "lastInteractionAt" | "interactions";

const interactionTypes = ["note", "call", "email", "meeting", "proposal"] as const;
const printFieldOptions: Array<{ value: PrintField; label: string }> = [
  { value: "firm", label: "Client / organization" },
  { value: "opportunityName", label: "Opportunity" },
  { value: "contact", label: "Contact" },
  { value: "referralSource", label: "Referral source" },
  { value: "stage", label: "Stage" },
  { value: "owner", label: "Assigned owner" },
  { value: "nextFollowUpDate", label: "Next follow-up" },
  { value: "lastInteractionAt", label: "Last interaction" },
  { value: "interactions", label: "Interaction history" },
];

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function displayDate(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00`)
    : asDate(value);
  return date ? date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—";
}

function dateInputValue(value: Date | string | null | undefined): string {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = asDate(value);
  return date ? localDateKey(date) : "";
}

function decisionLabel(prospect: Pick<ProspectRecord, "stage" | "closedAt">): string | null {
  if (prospect.stage !== "Won" && prospect.stage !== "Lost") return null;
  return validProspectDate(prospect.closedAt)
    ? `Decision: ${displayDate(prospect.closedAt)}`
    : "Decision: Undated — excluded from dated metrics";
}

function localDateTimeValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function interactionExportText(prospect: ProspectRecord, includePrivate: boolean): string {
  return prospect.interactions
    .filter((item) => includePrivate || !item.isPrivate)
    .map((item) => `${displayDate(item.happenedAt)} · ${item.type}${item.isPrivate ? " · PRIVATE" : ""}: ${item.content}`)
    .join(" | ");
}

function followUpBadge(status: ReturnType<typeof getFollowUpStatus>) {
  if (status === "overdue") {
    return <Badge className="border-red-800 bg-red-800 text-white hover:bg-red-800" aria-label="Follow-up overdue">Overdue</Badge>;
  }
  if (status === "today") {
    return <Badge className="border-amber-700 bg-amber-100 text-amber-950 hover:bg-amber-100" aria-label="Follow-up due today">Due Today</Badge>;
  }
  if (status === "upcoming") {
    return <Badge variant="outline" className="border-sky-700 bg-sky-50 text-sky-900">Scheduled</Badge>;
  }
  return null;
}

export default function Prospects() {
  const { user } = useAuth();
  const effectiveRole = useEffectiveRole(user?.role);
  const canManage = effectiveRole === "admin" || effectiveRole === "pm";
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState<{ active: boolean; source: string | null }>({ active: false, source: null });
  const [outcomeMode, setOutcomeMode] = useState<ProspectOutcomeListMode>("all");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [followUpFilter, setFollowUpFilter] = useState<FollowUpFilter>("all");
  const [followUpFrom, setFollowUpFrom] = useState("");
  const [followUpTo, setFollowUpTo] = useState("");
  const [interactionFrom, setInteractionFrom] = useState("");
  const [interactionTo, setInteractionTo] = useState("");
  const [outcomeFrom, setOutcomeFrom] = useState("");
  const [outcomeTo, setOutcomeTo] = useState("");
  const [sortBy, setSortBy] = useState<ProspectSort>("followup");
  const [sortDescending, setSortDescending] = useState(false);
  const [draftOpen, setDraftOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [includePrivateExport, setIncludePrivateExport] = useState(false);
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const printAfterDialogClose = useRef(false);
  const [includePrivatePrint, setIncludePrivatePrint] = useState(false);
  const [printFields, setPrintFields] = useState<PrintField[]>(printFieldOptions.map((field) => field.value));
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const refresh = () => setNow(new Date());
    let interval: number | undefined;
    const timeout = window.setTimeout(() => {
      refresh();
      interval = window.setInterval(refresh, 60_000);
    }, 60_000 - (Date.now() % 60_000));
    return () => {
      window.clearTimeout(timeout);
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, []);

  const { data: prospects, isLoading, error } = trpc.prospects.list.useQuery(undefined, { enabled: canManage });
  const { data: teamMembers } = trpc.teamMembers.list.useQuery(undefined, { enabled: canManage });
  const utils = trpc.useUtils();
  const recordList = (prospects ?? []) as ProspectRecord[];
  const memberList = teamMembers ?? [];
  const insightOwnerId = ownerFilter === "all" ? undefined : ownerFilter === "unassigned" ? null : Number(ownerFilter);
  const insights = useMemo(() => computeProspectInsights(recordList, {
    ownerId: insightOwnerId,
    from: outcomeFrom || undefined,
    to: outcomeTo || undefined,
  }), [recordList, insightOwnerId, outcomeFrom, outcomeTo]);
  const activeProspect = recordList.find((prospect) => prospect.id === detailId) ?? null;
  const editingProspect = editId == null ? null : recordList.find((prospect) => prospect.id === editId) ?? null;

  const refreshProspects = () => utils.prospects.list.invalidate();
  const createMutation = trpc.prospects.create.useMutation({
    onSuccess: () => {
      refreshProspects();
      setDraftOpen(false);
      setEditId(null);
      toast.success("Prospect added");
    },
    onError: (err) => toast.error(err.message || "Could not add prospect"),
  });
  const updateMutation = trpc.prospects.update.useMutation({
    onSuccess: () => {
      refreshProspects();
      setDraftOpen(false);
      setEditId(null);
      toast.success("Prospect updated");
    },
    onError: (err) => toast.error(err.message || "Could not update prospect"),
  });
  const interactionMutation = trpc.prospects.addInteraction.useMutation({
    onSuccess: () => {
      refreshProspects();
      toast.success("Interaction added to timeline");
    },
    onError: (err) => toast.error(err.message || "Could not add interaction"),
  });
  const convertMutation = trpc.prospects.convertToProject.useMutation({
    onSuccess: ({ projectId }) => {
      refreshProspects();
      utils.projects.list.invalidate();
      utils.dashboard.stats.invalidate();
      setDetailId(null);
      toast.success("Prospect converted to a project");
      setLocation(`/projects/${projectId}`);
    },
    onError: (err) => toast.error(err.message || "Could not convert prospect"),
  });

  const getOwnerName = (ownerId: number | null) => memberList.find((member) => member.id === ownerId)?.name ?? "Unassigned";
  const overdueCount = recordList.filter((prospect) => getFollowUpStatus(prospect.nextFollowUpDate, prospect.stage, now) === "overdue").length;
  const dueTodayCount = recordList.filter((prospect) => getFollowUpStatus(prospect.nextFollowUpDate, prospect.stage, now) === "today").length;

  const visibleProspects = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    const filtered = recordList.filter((prospect) => {
      if (!matchesProspectOutcomeList(prospect, { mode: outcomeMode, from: outcomeFrom || undefined, to: outcomeTo || undefined })) return false;
      if (stageFilter !== "all" && prospect.stage !== stageFilter) return false;
      if (sourceFilter.active && prospectReferralSourceKey(prospect.referralSource) !== sourceFilter.source) return false;
      if (ownerFilter !== "all" && String(prospect.ownerId ?? "unassigned") !== ownerFilter) return false;
      const status = getFollowUpStatus(prospect.nextFollowUpDate, prospect.stage, now);
      if (followUpFilter !== "all" && status !== followUpFilter && !(followUpFilter === "none" && status === "closed")) return false;
      if (followUpFilter === "none" && status === "closed" && prospect.nextFollowUpDate) return false;
      if (!prospectDateInRange(prospect.nextFollowUpDate, followUpFrom || undefined, followUpTo || undefined)) return false;
      if (!prospectDateInRange(prospect.lastInteractionAt, interactionFrom || undefined, interactionTo || undefined)) return false;
      if (normalizedSearch) {
        const searchable = [prospect.firm, prospect.opportunityName, prospect.contact, prospect.referralSource]
          .filter(Boolean).join(" ").toLowerCase();
        if (!searchable.includes(normalizedSearch)) return false;
      }
      return true;
    });

    const sorted = [...filtered].sort((a, b) => {
      let comparison = 0;
      if (sortBy === "stage") comparison = PROSPECT_STAGES.indexOf(a.stage) - PROSPECT_STAGES.indexOf(b.stage);
      if (sortBy === "owner") comparison = getOwnerName(a.ownerId).localeCompare(getOwnerName(b.ownerId));
      if (sortBy === "followup") comparison = (a.nextFollowUpDate ?? "9999-99-99").localeCompare(b.nextFollowUpDate ?? "9999-99-99");
      if (sortBy === "lastInteraction") {
        comparison = (asDate(a.lastInteractionAt)?.getTime() ?? 0) - (asDate(b.lastInteractionAt)?.getTime() ?? 0);
      }
      return sortDescending ? -comparison : comparison;
    });
    return sorted;
  }, [recordList, search, stageFilter, sourceFilter, outcomeMode, outcomeFrom, outcomeTo, ownerFilter, followUpFilter, followUpFrom, followUpTo, interactionFrom, interactionTo, sortBy, sortDescending, now, memberList]);

  const { working: workingProspects, converted: convertedProspects } = groupProspectsByConversion(visibleProspects);
  const hasActiveFilters = Boolean(search.trim() || stageFilter !== "all" || sourceFilter.active || outcomeMode !== "all" || outcomeFrom || outcomeTo || ownerFilter !== "all" || followUpFilter !== "all" || followUpFrom || followUpTo || interactionFrom || interactionTo);

  const clearOutcomeListSelection = () => {
    setStageFilter("all");
    setSourceFilter({ active: false, source: null });
  };
  const selectDatedOutcomes = () => {
    const alreadySelected = outcomeMode === "dated" && stageFilter === "all" && !sourceFilter.active;
    clearOutcomeListSelection();
    setOutcomeMode(alreadySelected ? "all" : "dated");
  };
  const selectOutcomeStage = (stage: "Won" | "Lost") => {
    const alreadySelected = outcomeMode === "dated" && stageFilter === stage && !sourceFilter.active;
    setStageFilter(alreadySelected ? "all" : stage);
    setSourceFilter({ active: false, source: null });
    setOutcomeMode(alreadySelected ? "all" : "dated");
  };
  const selectUndatedOutcomes = () => {
    const alreadySelected = outcomeMode === "undated";
    clearOutcomeListSelection();
    setOutcomeMode(alreadySelected ? "all" : "undated");
  };

  const resetFilters = () => {
    setSearch("");
    setStageFilter("all");
    setSourceFilter({ active: false, source: null });
    setOutcomeMode("all");
    setOwnerFilter("all");
    setFollowUpFilter("all");
    setFollowUpFrom("");
    setFollowUpTo("");
    setInteractionFrom("");
    setInteractionTo("");
    setOutcomeFrom("");
    setOutcomeTo("");
  };

  const submitProspect = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const ownerValue = String(form.get("ownerId") ?? "");
    const payload = {
      firm: String(form.get("firm") ?? "").trim() || null,
      opportunityName: String(form.get("opportunityName") ?? "").trim(),
      contact: String(form.get("contact") ?? "").trim() || null,
      referralSource: String(form.get("referralSource") ?? "").trim() || null,
      stage: String(form.get("stage") ?? "New") as ProspectStage,
      ownerId: ownerValue ? Number(ownerValue) : null,
      nextFollowUpDate: String(form.get("nextFollowUpDate") ?? "") || null,
      lastInteractionAt: String(form.get("lastInteractionAt") ?? "") || localDateKey(now),
    };
    if (editId != null) updateMutation.mutate({ ...payload, id: editId });
    else createMutation.mutate(payload);
  };

  const submitInteraction = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeProspect) return;
    const form = new FormData(event.currentTarget);
    const happenedAtValue = String(form.get("happenedAt") ?? "");
    interactionMutation.mutate({
      prospectId: activeProspect.id,
      type: String(form.get("type") ?? "note") as (typeof interactionTypes)[number],
      content: String(form.get("content") ?? "").trim(),
      happenedAt: happenedAtValue ? new Date(happenedAtValue) : new Date(),
      lastInteractionAt: happenedAtValue.slice(0, 10),
      isPrivate: form.get("isPrivate") === "on",
    });
    event.currentTarget.reset();
  };

  const exportCsv = () => {
    const headers = ["Client / organization", "Opportunity", "Contact", "Referral source", "Stage", "Assigned owner", "Next follow-up", "Last interaction", "Interaction history"];
    const lines = [headers.map(escapeCsvCell).join(",")];
    visibleProspects.forEach((prospect) => {
      const values = [
        prospect.firm,
        prospect.opportunityName,
        prospect.contact,
        prospect.referralSource,
        prospect.stage,
        getOwnerName(prospect.ownerId),
        prospect.nextFollowUpDate,
        displayDate(prospect.lastInteractionAt),
        interactionExportText(prospect, includePrivateExport),
      ];
      lines.push(values.map(escapeCsvCell).join(","));
    });
    const blob = new Blob(["\uFEFF", lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `studiotrac-prospects-${localDateKey(new Date())}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const printVisible = () => {
    printAfterDialogClose.current = true;
    setPrintDialogOpen(false);
  };

  const startEdit = (prospect: ProspectRecord) => {
    setDetailId(null);
    setEditId(prospect.id);
    setDraftOpen(true);
  };

  const renderProspectTable = (rows: ProspectRecord[]) => (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[920px] text-left text-sm">
        <thead className="border-b bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
          <tr><th className="px-4 py-3">Opportunity / client organization</th><th className="px-4 py-3">Stage</th><th className="px-4 py-3">Owner</th><th className="px-4 py-3">Next follow-up</th><th className="px-4 py-3">Last interaction</th><th className="px-4 py-3">Contact</th><th className="px-4 py-3">Actions</th></tr>
        </thead>
        <tbody>
          {rows.map((prospect) => {
            const status = getFollowUpStatus(prospect.nextFollowUpDate, prospect.stage, now);
            const rowTone = status === "overdue" ? "border-l-4 border-l-red-800 bg-red-50/80" : status === "today" ? "border-l-4 border-l-amber-600 bg-amber-50/80" : "border-l-4 border-l-transparent";
            return (
              <tr key={prospect.id} className={`border-b last:border-0 ${rowTone}`}>
                <td className="px-4 py-3">
                  <button type="button" onClick={() => setDetailId(prospect.id)} className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded">
                    <span className="block font-semibold text-foreground hover:text-primary">{prospect.opportunityName}</span>
                    {prospect.firm && <span className="block text-xs text-muted-foreground">{prospect.firm}</span>}
                    {decisionLabel(prospect) && <span className="mt-1 block text-xs text-muted-foreground">{decisionLabel(prospect)}</span>}
                  </button>
                  {prospect.convertedProjectId && <Badge variant="outline" className="mt-1">Converted</Badge>}
                </td>
                <td className="px-4 py-3"><Badge variant="outline">{prospect.stage}</Badge></td>
                <td className="px-4 py-3">{getOwnerName(prospect.ownerId)}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-col items-start gap-1">{followUpBadge(status)}<span className={status === "overdue" ? "font-semibold text-red-950" : status === "today" ? "font-semibold text-amber-950" : "text-muted-foreground"}>{displayDate(prospect.nextFollowUpDate)}</span></div>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{displayDate(prospect.lastInteractionAt)}</td>
                <td className="max-w-[220px] truncate px-4 py-3 text-muted-foreground">{prospect.contact || "—"}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    {prospect.convertedProjectId != null && <Button variant="outline" size="sm" asChild><Link href={`/projects/${prospect.convertedProjectId}`}>Open project</Link></Button>}
                    <Button variant="ghost" size="sm" onClick={() => startEdit(prospect)}>Edit</Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  if (!canManage) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <Card><CardContent className="p-6">
          <h1 className="text-lg font-semibold">Prospects are restricted</h1>
          <p className="mt-2 text-sm text-muted-foreground">Only admins and project managers can access the Prospects area.</p>
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <style>{`@media print { .prospects-screen-only { display: none !important; } .prospects-print-only { display: block !important; } [data-slot="dialog-overlay"], [data-slot="dialog-content"] { display: none !important; } body { background: white !important; } } @media screen { .prospects-print-only { display: none !important; } }`}</style>
      <div className="prospects-screen-only space-y-6">
        <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-medium text-primary">Business development</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight">Prospects</h1>
            <p className="mt-1 text-sm text-muted-foreground">Track opportunities and follow-ups separately from active projects.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={exportCsv} disabled={!visibleProspects.length}>
              <Download className="mr-2 h-4 w-4" /> Export CSV
            </Button>
            <Button variant="outline" onClick={() => setPrintDialogOpen(true)} disabled={!visibleProspects.length}>
              <Printer className="mr-2 h-4 w-4" /> Print / Save as PDF
            </Button>
            <Button onClick={() => { setEditId(null); setDraftOpen(true); }}>
              <Plus className="mr-2 h-4 w-4" /> Add prospect
            </Button>
          </div>
        </header>

        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setFollowUpFilter(followUpFilter === "overdue" ? "all" : "overdue")}
            aria-pressed={followUpFilter === "overdue"}
            className={`rounded-xl border-2 p-4 text-left transition-colors ${followUpFilter === "overdue" ? "border-red-800 bg-red-100" : "border-red-300 bg-red-50 hover:bg-red-100"}`}
          >
            <span className="flex items-center justify-between gap-3">
              <span className="font-semibold text-red-950">Overdue follow-ups</span>
              <Badge className="border-red-800 bg-red-800 text-white">{overdueCount}</Badge>
            </span>
            <span className="mt-1 block text-sm text-red-900">Past the scheduled date · select to filter</span>
          </button>
          <button
            type="button"
            onClick={() => setFollowUpFilter(followUpFilter === "today" ? "all" : "today")}
            aria-pressed={followUpFilter === "today"}
            className={`rounded-xl border-2 p-4 text-left transition-colors ${followUpFilter === "today" ? "border-amber-700 bg-amber-100" : "border-amber-300 bg-amber-50 hover:bg-amber-100"}`}
          >
            <span className="flex items-center justify-between gap-3">
              <span className="font-semibold text-amber-950">Due Today</span>
              <Badge className="border-amber-700 bg-amber-100 text-amber-950">{dueTodayCount}</Badge>
            </span>
            <span className="mt-1 block text-sm text-amber-950">Follow-up scheduled for today · select to filter</span>
          </button>
        </div>

        <Card className="border-0 shadow-sm">
          <CardContent className="space-y-4 p-4">
            <div className="grid gap-3 lg:grid-cols-[minmax(200px,1.5fr)_repeat(4,minmax(130px,1fr))]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search client / organization, opportunity, contact…" className="pl-9" aria-label="Search prospects" />
              </div>
              <Select value={stageFilter} onValueChange={setStageFilter}>
                <SelectTrigger aria-label="Filter by stage"><SelectValue placeholder="All stages" /></SelectTrigger>
                <SelectContent><SelectItem value="all">All stages</SelectItem>{PROSPECT_STAGES.map((stage) => <SelectItem key={stage} value={stage}>{stage}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={ownerFilter} onValueChange={setOwnerFilter}>
                <SelectTrigger aria-label="Filter by owner"><SelectValue placeholder="All owners" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All owners</SelectItem><SelectItem value="unassigned">Unassigned</SelectItem>
                  {memberList.map((member) => <SelectItem key={member.id} value={String(member.id)}>{member.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={followUpFilter} onValueChange={(value) => setFollowUpFilter(value as FollowUpFilter)}>
                <SelectTrigger aria-label="Filter by follow-up status"><SelectValue placeholder="All follow-ups" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All follow-ups</SelectItem><SelectItem value="overdue">Overdue</SelectItem><SelectItem value="today">Due Today</SelectItem><SelectItem value="upcoming">Upcoming</SelectItem><SelectItem value="none">No follow-up</SelectItem>
                </SelectContent>
              </Select>
              <Select value={sortBy} onValueChange={(value) => setSortBy(value as ProspectSort)}>
                <SelectTrigger aria-label="Sort prospects"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="followup">Sort: next follow-up</SelectItem><SelectItem value="lastInteraction">Sort: last interaction</SelectItem><SelectItem value="stage">Sort: stage</SelectItem><SelectItem value="owner">Sort: owner</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_auto]">
              <div><Label htmlFor="followup-from" className="text-xs text-muted-foreground">Follow-up from</Label><Input id="followup-from" type="date" value={followUpFrom} onChange={(event) => setFollowUpFrom(event.target.value)} /></div>
              <div><Label htmlFor="followup-to" className="text-xs text-muted-foreground">Follow-up to</Label><Input id="followup-to" type="date" value={followUpTo} onChange={(event) => setFollowUpTo(event.target.value)} /></div>
              <div><Label htmlFor="interaction-from" className="text-xs text-muted-foreground">Last interaction from</Label><Input id="interaction-from" type="date" value={interactionFrom} onChange={(event) => setInteractionFrom(event.target.value)} /></div>
              <div><Label htmlFor="interaction-to" className="text-xs text-muted-foreground">Last interaction to</Label><Input id="interaction-to" type="date" value={interactionTo} onChange={(event) => setInteractionTo(event.target.value)} /></div>
              <div className="flex items-end"><Button variant="ghost" onClick={resetFilters} className="w-full"><X className="mr-2 h-4 w-4" /> Clear filters</Button></div>
            </div>

            <div className="flex flex-col gap-2 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <input type="checkbox" checked={includePrivateExport} onChange={(event) => setIncludePrivateExport(event.target.checked)} className="h-4 w-4 accent-primary" />
                  Include private notes in CSV
                </label>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-3">
                <span className="text-xs text-muted-foreground">{outcomeMode === "undated" ? "Undated terminal records · date bounds do not apply" : outcomeMode === "dated" ? "Dated terminal outcomes only" : outcomeFrom || outcomeTo ? "Open snapshot unaffected · dated outcomes constrained by decision date" : "Open snapshot + all terminal outcomes"}</span>
                <span className="text-sm text-muted-foreground">{visibleProspects.length} of {recordList.length} prospects</span>
                <Button variant="ghost" size="sm" onClick={() => setSortDescending(!sortDescending)} aria-label={`Sort ${sortDescending ? "ascending" : "descending"}`} title="Reverse sort direction"><ArrowDownWideNarrow className="h-4 w-4" /> {sortDescending ? "Descending" : "Ascending"}</Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {(isLoading || error || workingProspects.length > 0 || visibleProspects.length === 0) && <Card className="border-0 shadow-sm">
          <CardContent className="p-0">
            {isLoading ? <div className="p-8 text-center text-sm text-muted-foreground">Loading prospects…</div> : null}
            {error ? <div className="p-8 text-center text-sm text-red-800">Could not load prospects: {error.message}</div> : null}
            {!isLoading && !error && visibleProspects.length === 0 ? (
              <div className="p-10 text-center">
                <UserRound className="mx-auto h-8 w-8 text-muted-foreground" />
                <h2 className="mt-3 font-semibold">{recordList.length ? "No matching prospects" : "Start your prospect pipeline"}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{recordList.length ? "Try clearing one or more filters." : "Add an opportunity here; it will stay separate from projects until you convert it."}</p>
              </div>
            ) : null}
            {workingProspects.length > 0 && renderProspectTable(workingProspects)}
          </CardContent>
        </Card>}

        {!isLoading && !error && visibleProspects.length > 0 && workingProspects.length === 0 && (
          <p className="text-sm text-muted-foreground">All matching prospects are in Converted to projects below.</p>
        )}
        {!isLoading && !error && (
          <ConvertedProspectsSection count={convertedProspects.length} hasActiveFilters={hasActiveFilters}>
            {renderProspectTable(convertedProspects)}
          </ConvertedProspectsSection>
        )}

        <Card className="border-0 shadow-sm">
          <CardContent className="space-y-4 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold">Prospect insights</h2>
                <p className="mt-1 text-sm text-muted-foreground">Current open snapshot by exact stage; owner scope follows current owner. Date range below applies only to dated Won/Lost outcomes.</p>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:min-w-[340px]">
                <div><Label htmlFor="outcome-from" className="text-xs text-muted-foreground">Closed outcomes from</Label><Input id="outcome-from" type="date" value={outcomeFrom} onChange={(event) => setOutcomeFrom(event.target.value)} /></div>
                <div><Label htmlFor="outcome-to" className="text-xs text-muted-foreground">Closed outcomes through</Label><Input id="outcome-to" type="date" value={outcomeTo} onChange={(event) => setOutcomeTo(event.target.value)} /></div>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {(["New", "Contacted", "Proposal", "Negotiation"] as const).map((stage) => (
                <button key={stage} type="button" onClick={() => { setStageFilter(stageFilter === stage ? "all" : stage); setSourceFilter({ active: false, source: null }); setOutcomeMode("all"); }} aria-pressed={stageFilter === stage && !sourceFilter.active && outcomeMode === "all"} className={`rounded-lg border p-3 text-left transition-colors ${stageFilter === stage && !sourceFilter.active && outcomeMode === "all" ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}>
                  <span className="block text-xs text-muted-foreground">Open · {stage}</span><span className="mt-1 block text-2xl font-semibold">{insights.openByStage[stage]}</span>
                </button>
              ))}
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <button type="button" onClick={() => selectOutcomeStage("Won")} aria-pressed={stageFilter === "Won" && !sourceFilter.active && outcomeMode === "dated"} className={`rounded-lg border p-3 text-left hover:bg-muted/50 ${stageFilter === "Won" && !sourceFilter.active && outcomeMode === "dated" ? "border-primary bg-primary/5" : ""}`}>
                <span className="block text-xs text-muted-foreground">Won · dated outcomes</span><span className="mt-1 block text-2xl font-semibold">{insights.wonCount}</span>
              </button>
              <button type="button" onClick={() => selectOutcomeStage("Lost")} aria-pressed={stageFilter === "Lost" && !sourceFilter.active && outcomeMode === "dated"} className={`rounded-lg border p-3 text-left hover:bg-muted/50 ${stageFilter === "Lost" && !sourceFilter.active && outcomeMode === "dated" ? "border-primary bg-primary/5" : ""}`}>
                <span className="block text-xs text-muted-foreground">Lost · dated outcomes</span><span className="mt-1 block text-2xl font-semibold">{insights.lostCount}</span>
              </button>
              <button type="button" onClick={selectDatedOutcomes} aria-pressed={outcomeMode === "dated" && stageFilter === "all" && !sourceFilter.active} className={`rounded-lg border p-3 text-left hover:bg-muted/50 ${outcomeMode === "dated" && stageFilter === "all" && !sourceFilter.active ? "border-primary bg-primary/5" : ""}`}><span className="block text-xs text-muted-foreground">Win rate · Won / (Won + Lost)</span><span className="mt-1 block text-2xl font-semibold">{insights.winRate == null ? "—" : `${(insights.winRate * 100).toFixed(1)}%`}</span><span className="text-xs text-muted-foreground">Denominator: {insights.closedOutcomeCount} dated closed outcomes · select to filter</span></button>
              <button type="button" onClick={selectDatedOutcomes} aria-pressed={outcomeMode === "dated" && stageFilter === "all" && !sourceFilter.active} className={`rounded-lg border p-3 text-left hover:bg-muted/50 ${outcomeMode === "dated" && stageFilter === "all" && !sourceFilter.active ? "border-primary bg-primary/5" : ""}`}><span className="block text-xs text-muted-foreground">Median days · created to decision</span><span className="mt-1 block text-2xl font-semibold">{insights.medianElapsedDays == null ? "—" : insights.medianElapsedDays.toLocaleString(undefined, { maximumFractionDigits: 1 })}</span><span className="text-xs text-muted-foreground">Elapsed time for valid dated outcomes · select to filter</span></button>
            </div>
            <div className="rounded-lg border">
              <div className="border-b px-3 py-2"><h3 className="font-medium">Won by exact referral source</h3><p className="text-xs text-muted-foreground">Win rate denominator is that source’s dated closed outcomes (Won + Lost). Source text is kept exact; missing source is its own bucket.</p></div>
              {insights.byReferralSource.length ? (
                <div className="divide-y">
                  {insights.byReferralSource.map((source) => {
                    const selected = outcomeMode === "dated" && stageFilter === "all" && sourceFilter.active && sourceFilter.source === source.source;
                    return <button key={source.source === null ? "missing-source" : `source:${source.source}`} type="button" onClick={() => { setStageFilter("all"); setSourceFilter(selected ? { active: false, source: null } : { active: true, source: source.source }); setOutcomeMode(selected ? "all" : "dated"); }} aria-pressed={selected} className={`grid w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted/50 ${selected ? "bg-primary/5" : ""}`}>
                      <span className="truncate font-medium">{source.label}</span><span>{source.wonCount} / {source.closedOutcomeCount} won</span><span className="min-w-14 text-right font-semibold">{(source.winRate * 100).toFixed(1)}%</span>
                    </button>;
                  })}
                </div>
              ) : <p className="p-4 text-sm text-muted-foreground">No dated closed outcomes in this owner and date scope.</p>}
            </div>
            <button type="button" onClick={selectUndatedOutcomes} aria-pressed={outcomeMode === "undated"} className={`w-full rounded-lg border p-3 text-left text-xs text-muted-foreground hover:bg-muted/50 ${outcomeMode === "undated" ? "border-primary bg-primary/5" : ""}`}>
              {insights.undatedOutcomeCount} undated terminal prospect{insights.undatedOutcomeCount === 1 ? " is" : "s are"} in the current owner scope, excluded from dated outcome metrics. Select to view them regardless of outcome-date bounds; no historical decision dates are inferred.
            </button>
          </CardContent>
        </Card>

        <Dialog open={draftOpen} onOpenChange={(open) => { setDraftOpen(open); if (!open) setEditId(null); }}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
            <DialogHeader><DialogTitle>{editingProspect ? "Edit prospect" : "Add prospect"}</DialogTitle></DialogHeader>
            <form onSubmit={submitProspect} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2"><Label htmlFor="prospect-firm">Client / organization</Label><Input id="prospect-firm" name="firm" maxLength={255} defaultValue={editingProspect?.firm ?? ""} /></div>
                <div className="space-y-2"><Label htmlFor="prospect-name">Opportunity name *</Label><Input id="prospect-name" name="opportunityName" required maxLength={500} defaultValue={editingProspect?.opportunityName ?? ""} /></div>
                <div className="space-y-2"><Label htmlFor="prospect-contact">Contact</Label><Input id="prospect-contact" name="contact" maxLength={500} placeholder="Name, role, email or phone" defaultValue={editingProspect?.contact ?? ""} /></div>
                <div className="space-y-2"><Label htmlFor="prospect-referral">Referral source</Label><Input id="prospect-referral" name="referralSource" maxLength={255} defaultValue={editingProspect?.referralSource ?? ""} /></div>
                <div className="space-y-2"><Label htmlFor="prospect-stage">Stage</Label><select id="prospect-stage" name="stage" defaultValue={editingProspect?.stage ?? "New"} disabled={!!editingProspect?.convertedProjectId} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">{PROSPECT_STAGES.map((stage) => <option key={stage} value={stage}>{stage}</option>)}</select>{editingProspect?.convertedProjectId && <p className="text-xs text-muted-foreground">Stage is locked after conversion.</p>}</div>
                <div className="space-y-2"><Label htmlFor="prospect-owner">Assigned owner</Label><select id="prospect-owner" name="ownerId" defaultValue={editingProspect?.ownerId ? String(editingProspect.ownerId) : ""} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="">Unassigned</option>{memberList.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></div>
                <div className="space-y-2 sm:col-span-2"><Label htmlFor="prospect-followup">Next follow-up date</Label><Input id="prospect-followup" name="nextFollowUpDate" type="date" defaultValue={editingProspect?.nextFollowUpDate ?? ""} /></div>
                <div className="space-y-2 sm:col-span-2"><Label htmlFor="prospect-last-interaction">Last interaction</Label><Input id="prospect-last-interaction" name="lastInteractionAt" type="date" defaultValue={editingProspect ? dateInputValue(editingProspect.lastInteractionAt) : localDateKey(now)} required /></div>
              </div>
              <div className="flex justify-end gap-2 border-t pt-4"><Button type="button" variant="outline" onClick={() => setDraftOpen(false)}>Cancel</Button><Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>{createMutation.isPending || updateMutation.isPending ? "Saving…" : "Save prospect"}</Button></div>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog open={!!activeProspect} onOpenChange={(open) => { if (!open) setDetailId(null); }}>
          <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
            {activeProspect && <>
              <DialogHeader>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div><DialogTitle className="text-xl">{activeProspect.opportunityName}</DialogTitle>{activeProspect.firm && <p className="mt-1 text-sm text-muted-foreground">Client / organization: {activeProspect.firm}</p>}</div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" onClick={() => startEdit(activeProspect)}>Edit details</Button>
                    {activeProspect.stage === "Won" && !activeProspect.convertedProjectId && <Button onClick={() => {
                      if (window.confirm(`Convert “${activeProspect.opportunityName}” into an active project? This creates a project with no financial data and copies non-private history.`)) convertMutation.mutate({ id: activeProspect.id });
                    }} disabled={convertMutation.isPending}>{convertMutation.isPending ? "Converting…" : "Convert to Project"}</Button>}
                    {activeProspect.convertedProjectId && <Button variant="outline" onClick={() => setLocation(`/projects/${activeProspect.convertedProjectId}`)}>Open project</Button>}
                  </div>
                </div>
              </DialogHeader>
              <div className="grid gap-3 rounded-lg bg-muted/30 p-4 sm:grid-cols-2 lg:grid-cols-3">
                <div><span className="text-xs text-muted-foreground">Stage</span><div className="mt-1"><Badge variant="outline">{activeProspect.stage}</Badge></div></div>
                <div><span className="text-xs text-muted-foreground">Assigned owner</span><p className="mt-1 text-sm font-medium">{getOwnerName(activeProspect.ownerId)}</p></div>
                <div><span className="text-xs text-muted-foreground">Next follow-up</span><div className="mt-1 flex items-center gap-2">{followUpBadge(getFollowUpStatus(activeProspect.nextFollowUpDate, activeProspect.stage, now))}<span className="text-sm">{displayDate(activeProspect.nextFollowUpDate)}</span></div></div>
                <div><span className="text-xs text-muted-foreground">Contact</span><p className="mt-1 text-sm">{activeProspect.contact || "—"}</p></div>
                <div><span className="text-xs text-muted-foreground">Referral source</span><p className="mt-1 text-sm">{activeProspect.referralSource || "—"}</p></div>
                {decisionLabel(activeProspect) && <div><span className="text-xs text-muted-foreground">Decision date</span><p className="mt-1 text-sm">{decisionLabel(activeProspect)}</p></div>}
                {activeProspect.convertedAt && <div><span className="text-xs text-muted-foreground">Converted</span><p className="mt-1 text-sm">{displayDate(activeProspect.convertedAt)}</p></div>}
              </div>

              <section className="space-y-3">
                <div className="flex items-center justify-between"><h2 className="font-semibold">Interaction timeline</h2><span className="text-xs text-muted-foreground">Private notes stay out of exports by default</span></div>
                <form onSubmit={submitInteraction} className="space-y-3 rounded-lg border p-3">
                  <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
                    <div className="space-y-2"><Label htmlFor="interaction-type">Type</Label><select id="interaction-type" name="type" className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">{interactionTypes.map((type) => <option key={type} value={type}>{type.charAt(0).toUpperCase() + type.slice(1)}</option>)}</select></div>
                    <div className="space-y-2"><Label htmlFor="interaction-date">Date and time</Label><Input id="interaction-date" name="happenedAt" type="datetime-local" defaultValue={localDateTimeValue(new Date())} required /></div>
                  </div>
                  <div className="space-y-2"><Label htmlFor="interaction-content">Notes</Label><Textarea id="interaction-content" name="content" required maxLength={10000} placeholder="Record a call, email, meeting, proposal, or note…" rows={3} /></div>
                  <div className="flex flex-wrap items-center justify-between gap-3"><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isPrivate" className="h-4 w-4 accent-primary" /> Private note (excluded from exports by default)</label><Button type="submit" size="sm" disabled={interactionMutation.isPending}><Plus className="mr-2 h-4 w-4" /> Add to timeline</Button></div>
                </form>
                <div className="space-y-3">
                  {activeProspect.interactions.length === 0 && <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No interactions yet.</p>}
                  {activeProspect.interactions.map((item) => (
                    <article key={item.id} className={`rounded-lg border p-3 ${item.isPrivate ? "border-violet-300 bg-violet-50/70" : "bg-background"}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><Badge variant="outline">{item.type}</Badge>{item.isPrivate && <Badge className="border-violet-700 bg-violet-100 text-violet-950">Private</Badge>}</div><span className="text-xs text-muted-foreground">{displayDate(item.happenedAt)} · {asDate(item.happenedAt)?.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} · {item.authorName}</span></div>
                      <p className="mt-2 whitespace-pre-wrap text-sm">{item.content}</p>
                    </article>
                  ))}
                </div>
              </section>
            </>}
          </DialogContent>
        </Dialog>

        <Dialog open={printDialogOpen} onOpenChange={(open) => { if (open) printAfterDialogClose.current = false; setPrintDialogOpen(open); }}>
          <DialogContent className="sm:max-w-lg" onCloseAutoFocus={() => {
            if (printAfterDialogClose.current) {
              printAfterDialogClose.current = false;
              window.print();
            }
          }}>
            <DialogHeader><DialogTitle>Print / Save as PDF</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">Choose which fields appear in the clean print view. In your browser’s print dialog, choose “Save as PDF” to create a PDF.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {printFieldOptions.map((field) => <label key={field.value} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={printFields.includes(field.value)} onChange={(event) => setPrintFields((current) => event.target.checked ? [...current, field.value] : current.filter((value) => value !== field.value))} className="h-4 w-4 accent-primary" />{field.label}</label>)}
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={includePrivatePrint} onChange={(event) => setIncludePrivatePrint(event.target.checked)} className="h-4 w-4 accent-primary" />Include private notes</label>
            </div>
            <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setPrintDialogOpen(false)}>Cancel</Button><Button onClick={printVisible}><Printer className="mr-2 h-4 w-4" /> Print</Button></div>
          </DialogContent>
        </Dialog>
      </div>

      <div id="prospects-print-view" className="prospects-print-only p-5 text-black">
        <h1 className="mb-1 text-2xl font-bold">StudioTrac Prospects</h1>
        <p className="mb-5 text-sm">Printed {new Date().toLocaleDateString()} · {visibleProspects.length} records</p>
        <table className="w-full border-collapse text-left text-xs">
          <thead><tr>{printFieldOptions.filter((field) => printFields.includes(field.value)).map((field) => <th key={field.value} className="border border-slate-400 bg-slate-100 p-2">{field.label}</th>)}</tr></thead>
          <tbody>{visibleProspects.map((prospect) => <tr key={prospect.id}>
            {printFields.includes("firm") && <td className="border border-slate-300 p-2">{prospect.firm}</td>}
            {printFields.includes("opportunityName") && <td className="border border-slate-300 p-2">{prospect.opportunityName}</td>}
            {printFields.includes("contact") && <td className="border border-slate-300 p-2">{prospect.contact || "—"}</td>}
            {printFields.includes("referralSource") && <td className="border border-slate-300 p-2">{prospect.referralSource || "—"}</td>}
            {printFields.includes("stage") && <td className="border border-slate-300 p-2">{prospect.stage}</td>}
            {printFields.includes("owner") && <td className="border border-slate-300 p-2">{getOwnerName(prospect.ownerId)}</td>}
            {printFields.includes("nextFollowUpDate") && <td className="border border-slate-300 p-2">{displayDate(prospect.nextFollowUpDate)}</td>}
            {printFields.includes("lastInteractionAt") && <td className="border border-slate-300 p-2">{displayDate(prospect.lastInteractionAt)}</td>}
            {printFields.includes("interactions") && <td className="border border-slate-300 p-2">{interactionExportText(prospect, includePrivatePrint)}</td>}
          </tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}
