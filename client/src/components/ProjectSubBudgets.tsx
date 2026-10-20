import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { PROJECT_PHASES, getPhaseLabel } from "@shared/constants";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Plus, Pencil, Trash2, DollarSign } from "lucide-react";
import { toast } from "sonner";

type SubBudgetKind = "within_existing" | "approved_addition";
type SubBudgetStatus = "proposed" | "approved" | "complete";
type SubBudgetForm = { id?: number; name: string; phase: string; description: string; amount: string; kind: SubBudgetKind; status: SubBudgetStatus };
const emptyForm = (): SubBudgetForm => ({ name: "", phase: "__custom__", description: "", amount: "", kind: "within_existing", status: "proposed" });
const currency = (cents: number) => `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function ProjectSubBudgets({ projectId, billingType, notToExceedCents }: { projectId: number; billingType?: string; notToExceedCents?: number | null }) {
  const utils = trpc.useUtils();
  const query = trpc.subBudgets.list.useQuery({ projectId });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<SubBudgetForm>(emptyForm());
  const [formError, setFormError] = useState("");

  const invalidateFinancials = () => {
    utils.subBudgets.list.invalidate({ projectId });
    utils.subBudgets.options.invalidate({ projectId });
    utils.projects.get.invalidate({ id: projectId });
    utils.projects.list.invalidate();
    utils.projects.financialSummary.invalidate({ id: projectId });
    utils.netIncome.project.invalidate({ projectId });
    utils.financials.overview.invalidate();
    utils.timeAnalytics.projectBurnRate.invalidate({ projectId });
    utils.timeAnalytics.allProjectsBudgetSummary.invalidate();
  };
  const closeAndReset = () => { setDialogOpen(false); setForm(emptyForm()); setFormError(""); };
  const create = trpc.subBudgets.create.useMutation({ onSuccess: () => { invalidateFinancials(); closeAndReset(); toast.success("Sub-budget added"); }, onError: (error) => { setFormError(error.message); toast.error(`Could not add sub-budget: ${error.message}`); } });
  const update = trpc.subBudgets.update.useMutation({ onSuccess: () => { invalidateFinancials(); closeAndReset(); toast.success("Sub-budget updated"); }, onError: (error) => { setFormError(error.message); toast.error(`Could not update sub-budget: ${error.message}`); } });
  const remove = trpc.subBudgets.delete.useMutation({ onSuccess: () => { invalidateFinancials(); toast.success("Sub-budget deleted"); }, onError: (error) => { toast.error(`Could not delete sub-budget: ${error.message}`); } });

  const openNew = () => { setForm(emptyForm()); setFormError(""); setDialogOpen(true); };
  const openEdit = (item: NonNullable<typeof query.data>["items"][number]) => {
    setForm({ id: item.id, name: item.name, phase: item.phase ?? "__custom__", description: item.description ?? "", amount: (item.budgetCents / 100).toFixed(2), kind: item.kind, status: item.status });
    setFormError("");
    setDialogOpen(true);
  };
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setFormError("");
    const amountCents = Math.round(Number(form.amount) * 100);
    if (!form.name.trim() || !Number.isFinite(amountCents) || amountCents < 0) {
      setFormError("Enter a name and a valid non-negative budget amount.");
      return;
    }
    const payload = { name: form.name.trim(), phase: form.phase === "__custom__" ? null : form.phase as (typeof PROJECT_PHASES)[number]["value"], description: form.description.trim(), budgetCents: amountCents, kind: form.kind, status: form.status };
    if (form.id) update.mutate({ id: form.id, ...payload });
    else create.mutate({ projectId, ...payload });
  };
  const busy = create.isPending || update.isPending;
  const isHourly = billingType === "hourly";

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base font-semibold flex items-center gap-2"><DollarSign className="h-4 w-4 text-muted-foreground" /> Project Sub-Budgets</CardTitle>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={openNew}><Plus className="h-3 w-3 mr-1" /> Add Sub-Budget</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {query.isLoading ? <p className="text-sm text-muted-foreground">Loading sub-budgets…</p> : query.error ? <p role="alert" className="text-sm text-red-600">Could not load sub-budgets: {query.error.message}</p> : (
          <>
            {query.data && <div className={`grid grid-cols-1 ${isHourly && notToExceedCents ? "sm:grid-cols-2" : "sm:grid-cols-3"} gap-3 rounded-lg bg-muted/30 p-3`}>
              {isHourly ? <>
                <div><p className="text-xs text-muted-foreground">Billing model</p><p className="font-semibold">Hourly — no fixed fee cap</p></div>
                <div><p className="text-xs text-muted-foreground">Original NTE</p><p className="font-semibold">{notToExceedCents ? currency(notToExceedCents) : "Not set"}</p></div>
                <div><p className="text-xs text-muted-foreground">Approved additions</p><p className="font-semibold">{currency(query.data.approvedAdditionsCents)}</p></div>
                {!!notToExceedCents && <div><p className="text-xs text-muted-foreground">Approved NTE</p><p className="font-semibold">{currency(query.data.approvedBudgetCents)}</p></div>}
              </> : <>
                <div><p className="text-xs text-muted-foreground">Original contract</p><p className="font-semibold">{currency(query.data.originalBudgetCents)}</p></div>
                <div><p className="text-xs text-muted-foreground">Approved additions</p><p className="font-semibold">{currency(query.data.approvedAdditionsCents)}</p></div>
                <div><p className="text-xs text-muted-foreground">Approved budget</p><p className="font-semibold">{currency(query.data.approvedBudgetCents)}</p></div>
              </>}
            </div>}
            <p className="text-xs text-muted-foreground">{isHourly ? "Hourly billing stays hourly. Approved additions increase an existing NTE only; without an NTE, no project cap is created. Original billing terms are retained. Proposed additions are excluded; completed approved additions remain included." : "The original contract remains unchanged. Proposed items are excluded from the approved budget; completed approved additions remain included."} Sub-budgets do not change the project’s overall status.</p>
            {!query.data?.items.length ? <p className="text-sm text-muted-foreground text-center py-2">No sub-budgets yet.</p> : <div className="space-y-2">
              {query.data.items.map((item) => <div key={item.id} className="rounded-lg border p-3 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium">{item.name}</span><Badge variant="outline" className="text-[10px]">{item.kind === "approved_addition" ? "Approved addition" : "Within existing"}</Badge><Badge variant="secondary" className="text-[10px]">{item.status}</Badge></div>
                    <p className="text-xs text-muted-foreground mt-1">{item.phase ? getPhaseLabel(item.phase) : "Custom / unassigned"}{item.description ? ` · ${item.description}` : ""}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Edit ${item.name}`} onClick={() => openEdit(item)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7 text-red-500" aria-label={`Delete ${item.name}`}><Trash2 className="h-3.5 w-3.5" /></Button></AlertDialogTrigger>
                      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete sub-budget?</AlertDialogTitle><AlertDialogDescription>Delete “{item.name}”? The server will prevent deletion if costs are attributed to this sub-budget.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => remove.mutate({ id: item.id })} className="bg-red-600 hover:bg-red-700" disabled={remove.isPending}>Delete</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div><span className="text-muted-foreground">Budget</span><p className="font-medium">{currency(item.budgetCents)}</p></div>
                  <div><span className="text-muted-foreground">Actual</span><p className="font-medium">{currency(item.actualCents)}</p></div>
                  <div><span className="text-muted-foreground">Remaining</span><p className={`font-medium ${item.remainingCents < 0 ? "text-red-600" : ""}`}>{currency(item.remainingCents)}</p></div>
                </div>
              </div>)}
            </div>}
          </>
        )}
      </CardContent>
      <Dialog open={dialogOpen} onOpenChange={(open) => open ? setDialogOpen(true) : closeAndReset()}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>{form.id ? "Edit Sub-Budget" : "Add Sub-Budget"}</DialogTitle></DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2"><Label htmlFor="subbudget-name">Name</Label><Input id="subbudget-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={160} placeholder="e.g., Lobby renovation" /></div>
            <div className="space-y-2"><Label>Phase</Label><Select value={form.phase} onValueChange={(phase) => setForm({ ...form, phase })}><SelectTrigger><SelectValue placeholder="Select a phase" /></SelectTrigger><SelectContent><SelectItem value="__custom__">Custom / unassigned</SelectItem>{PROJECT_PHASES.map((phase) => <SelectItem key={phase.value} value={phase.value}>{phase.label}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><Label htmlFor="subbudget-description">Description</Label><Textarea id="subbudget-description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} placeholder="Optional scope notes" /></div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-2"><Label htmlFor="subbudget-amount">Budget amount ($)</Label><Input id="subbudget-amount" type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required /></div>
              <div className="space-y-2"><Label>Budget type</Label><Select value={form.kind} onValueChange={(kind) => setForm({ ...form, kind: kind as SubBudgetKind })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="within_existing">Within existing</SelectItem><SelectItem value="approved_addition">Approved addition</SelectItem></SelectContent></Select></div>
              <div className="space-y-2"><Label>Status</Label><Select value={form.status} onValueChange={(status) => setForm({ ...form, status: status as SubBudgetStatus })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="proposed">Proposed</SelectItem><SelectItem value="approved">Approved</SelectItem><SelectItem value="complete">Complete</SelectItem></SelectContent></Select></div>
            </div>
            {form.kind === "approved_addition" && <p className="text-xs text-muted-foreground">An addition must be saved as Approved before it can be marked Complete.</p>}
            {formError && <p role="alert" className="text-sm text-red-600">{formError}</p>}
            <DialogFooter><Button type="button" variant="outline" onClick={closeAndReset}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Saving…" : form.id ? "Save Changes" : "Add Sub-Budget"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
